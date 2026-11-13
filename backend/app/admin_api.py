"""Owner-only reporting and runtime settings for the admin console."""

from datetime import datetime, timedelta, timezone
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session, aliased

from app.config import UPLOAD_DIR, settings
from app.db import get_db
from app.limiter import limit
from app.models import (
    Comment,
    Post,
    SameSkyAnalysis,
    SameSkyEmbedding,
    SameSkyJob,
    SameSkyMatch,
    SameSkyProfile,
    SystemSetting,
    User,
    UserBlock,
)
from app.security import read_user_id
from app.same_sky_ai import safe_themes
from app.same_sky_common import ELIGIBLE_ENTRY_STATUSES, update_eligibility
from app.same_sky_scoring import score_candidate
from app.system_settings import AI_PROVIDER, AI_PROVIDER_VALUES, DEFAULT_THEME, DEFAULT_THEME_VALUES, REQUIRED_CONFESSIONS, REQUIRED_POSTS, RETRY_MINUTES, default_theme, same_sky_ai_provider, same_sky_rules
from app.worker_control import get_worker_status, process_batch, start_worker, stop_worker

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminSettingsUpdate(BaseModel):
    same_sky_required_posts: int = Field(ge=1, le=100)
    same_sky_required_confessions: int = Field(ge=1, le=100)
    same_sky_retry_minutes: int = Field(ge=1, le=43200)
    same_sky_ai_provider: Literal["gemini", "groq"] | None = None
    default_theme: Literal["acid-lime", "electric-purple", "chaos-coral", "midnight", "classic-paper"] | None = None


def admin_user(request: Request, db: Session = Depends(get_db)) -> User:
    admin_emails = {
        value.strip().lower()
        for value in settings.admin_emails.split(",")
        if value.strip()
    }
    if not admin_emails:
        raise HTTPException(status_code=503, detail="Admin access is not configured on the backend.")
    user = db.get(User, read_user_id(request))
    if user is None:
        raise HTTPException(status_code=401, detail="Log in again.")
    if user.email.lower() not in admin_emails:
        raise HTTPException(status_code=403, detail="This account does not have admin access.")
    return user


@router.get("/me")
def admin_me(user: User = Depends(admin_user)) -> dict:
    return {"id": str(user.id), "email": user.email, "username": user.username}


@router.get("/overview")
def admin_overview(
    db: Session = Depends(get_db),
    _admin: User = Depends(admin_user),
) -> dict:
    now = datetime.now(timezone.utc)
    users_total = db.scalar(select(func.count(User.id))) or 0
    ever_logged_in = db.scalar(select(func.count(User.id)).where(User.last_login_at.is_not(None))) or 0
    signed_in_24h = db.scalar(select(func.count(User.id)).where(User.last_login_at >= now - timedelta(hours=24))) or 0
    signed_in_7d = db.scalar(select(func.count(User.id)).where(User.last_login_at >= now - timedelta(days=7))) or 0
    post_count = db.scalar(select(func.count(Post.id)).where(Post.surface == "feed")) or 0
    confession_count = db.scalar(select(func.count(Post.id)).where(Post.surface == "confession")) or 0
    opted_in = db.scalar(select(func.count(SameSkyProfile.id)).where(SameSkyProfile.matching_enabled.is_(True))) or 0
    job_statuses = dict(db.execute(select(SameSkyJob.status, func.count(SameSkyJob.id)).group_by(SameSkyJob.status)).all())
    return {
        "users_total": users_total,
        "users_ever_logged_in": ever_logged_in,
        "signins_last_24h": signed_in_24h,
        "signins_last_7d": signed_in_7d,
        "posts_total": post_count,
        "confessions_total": confession_count,
        "same_sky_matching_enabled": opted_in,
        "same_sky_jobs": job_statuses,
        "worker_status": get_worker_status(),
        "settings": {**same_sky_rules(db), "same_sky_ai_provider": same_sky_ai_provider(db), "default_theme": default_theme(db)},
        "ai_provider_status": {
            "gemini": settings.same_sky_gemini_ready,
            "groq": settings.same_sky_gemini_ready and bool(settings.groq_api_key),
        },
    }


@router.get("/worker/status")
def admin_worker_status(_admin: User = Depends(admin_user)) -> dict:
    return get_worker_status()


@router.post("/worker/start")
def admin_worker_start(_admin: User = Depends(admin_user)) -> dict:
    return start_worker()


@router.post("/worker/stop")
def admin_worker_stop(_admin: User = Depends(admin_user)) -> dict:
    return stop_worker()


@router.post("/worker/process-batch")
def admin_worker_process_batch(_admin: User = Depends(admin_user)) -> dict:
    return process_batch(max_jobs=50)


@router.get("/users")
def admin_users(
    q: str = "",
    page: int = 1,
    page_size: int = 30,
    db: Session = Depends(get_db),
    _admin: User = Depends(admin_user),
) -> dict:
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    normalized_query = q.strip()[:120]
    feed_count = select(func.count(Post.id)).where(Post.author_id == User.id, Post.surface == "feed").scalar_subquery()
    confession_count = select(func.count(Post.id)).where(Post.author_id == User.id, Post.surface == "confession").scalar_subquery()
    selected_count = select(func.count(SameSkyAnalysis.post_id)).where(
        SameSkyAnalysis.user_id == User.id,
    ).scalar_subquery()
    ready_count = select(func.count(SameSkyAnalysis.post_id)).where(
        SameSkyAnalysis.user_id == User.id,
        SameSkyAnalysis.processing_status == "ready",
    ).scalar_subquery()
    statement = (
        select(
            User,
            feed_count.label("posts_count"),
            confession_count.label("confessions_count"),
            selected_count.label("same_sky_selected"),
            ready_count.label("same_sky_ready"),
            SameSkyProfile.eligibility_status,
            SameSkyProfile.matching_enabled,
        )
        .outerjoin(SameSkyProfile, SameSkyProfile.user_id == User.id)
        .order_by(User.last_login_at.desc().nullslast(), User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if normalized_query:
        pattern = f"%{normalized_query}%"
        statement = statement.where(or_(User.username.ilike(pattern), User.email.ilike(pattern)))
    rows = db.execute(statement).all()
    total_statement = select(func.count(User.id))
    if normalized_query:
        pattern = f"%{normalized_query}%"
        total_statement = total_statement.where(or_(User.username.ilike(pattern), User.email.ilike(pattern)))
    total = db.scalar(total_statement) or 0
    return {
        "users": [
            {
                "id": str(user.id),
                "username": user.username,
                "email": user.email,
                "joined_at": user.created_at,
                "last_login_at": user.last_login_at,
                "last_active_at": user.last_active_at,
                "posts_count": posts_count,
                "confessions_count": confessions_count,
                "same_sky_selected": selected,
                "same_sky_ready": ready,
                "same_sky_eligibility": eligibility or "not_started",
                "same_sky_matching_enabled": bool(matching_enabled),
            }
            for user, posts_count, confessions_count, selected, ready, eligibility, matching_enabled in rows
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@router.put("/settings")
def update_admin_settings(
    body: AdminSettingsUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(admin_user),
) -> dict:
    if body.same_sky_ai_provider is not None and not settings.same_sky_gemini_ready:
        raise HTTPException(status_code=409, detail="A billing-enabled Gemini project is required for Same Sky embeddings.")
    if body.same_sky_ai_provider == "groq" and not settings.groq_api_key:
        raise HTTPException(status_code=409, detail="Groq is selected but GROQ_API_KEY is not configured on the backend.")
    values = {
        REQUIRED_POSTS: body.same_sky_required_posts,
        REQUIRED_CONFESSIONS: body.same_sky_required_confessions,
        RETRY_MINUTES: body.same_sky_retry_minutes,
    }
    if body.same_sky_ai_provider is not None:
        values[AI_PROVIDER] = AI_PROVIDER_VALUES[body.same_sky_ai_provider]
    if body.default_theme is not None:
        values[DEFAULT_THEME] = DEFAULT_THEME_VALUES[body.default_theme]
    for key, value in values.items():
        row = db.get(SystemSetting, key)
        if row is None:
            db.add(SystemSetting(key=key, value=value, updated_by_id=admin.id))
        else:
            row.value = value
            row.updated_by_id = admin.id
    db.flush()
    for profile in db.scalars(select(SameSkyProfile)).all():
        update_eligibility(db, profile)
    db.commit()
    return {"settings": {**same_sky_rules(db), "same_sky_ai_provider": same_sky_ai_provider(db), "default_theme": default_theme(db)}, "saved": True}


@router.get("/users/{user_id}")
def admin_user_detail(
    user_id: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(admin_user),
) -> dict:
    import uuid

    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found.") from None
    user = db.get(User, user_uuid)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return admin_users_for_one(db, user)


def before_cursor(statement, model, cursor):
    if not cursor:
        return statement
    try:
        stamp, _, key = cursor.partition("|")
        before = datetime.fromisoformat(stamp)
        before_id = uuid.UUID(key)
        if before.tzinfo is None:
            raise ValueError()
    except ValueError:
        raise HTTPException(400, "Bad cursor.") from None
    return statement.where(
        (model.created_at < before) | ((model.created_at == before) & (model.id < before_id))
    )


@router.get("/users/{user_id}/stories")
def admin_user_stories(
    user_id: uuid.UUID,
    response: Response,
    surface: Literal["feed", "confession"] = "feed",
    cursor: str | None = None,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin: User = Depends(admin_user),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    if db.get(User, user_id) is None:
        raise HTTPException(404, "User not found.")

    stmt = select(Post).where(Post.author_id == user_id, Post.surface == surface)
    stmt = before_cursor(stmt, Post, cursor)

    rows = db.scalars(stmt.order_by(Post.created_at.desc(), Post.id.desc()).limit(limit + 1)).all()
    page = rows[:limit]
    return {
        "posts": [{
            "id": post.id,
            "body": post.body,
            "created_at": post.created_at,
            "visibility": post.visibility,
            "is_anonymous": post.is_anonymous,
            "image_url": f"/admin/stories/{post.id}/image" if post.image_file else None,
        } for post in page],
        "next_cursor": f"{page[-1].created_at.isoformat()}|{page[-1].id}" if len(rows) > limit else None,
    }


@router.get("/users/{user_id}/comments")
def admin_user_comments(
    user_id: uuid.UUID,
    response: Response,
    cursor: str | None = None,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin: User = Depends(admin_user),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    if db.get(User, user_id) is None:
        raise HTTPException(404, "User not found.")

    statement = (
        select(Comment, Post.surface, Post.visibility)
        .join(Post, Comment.post_id == Post.id)
        .where(Comment.author_id == user_id, Comment.deleted_at.is_(None))
        .order_by(Comment.created_at.desc(), Comment.id.desc())
        .limit(limit + 1)
    )
    rows = db.execute(before_cursor(statement, Comment, cursor)).all()
    page = rows[:limit]
    last = page[-1][0] if page else None
    return {
        "comments": [{
            "id": comment.id,
            "post_id": comment.post_id,
            "body": comment.body,
            "created_at": comment.created_at,
            "is_anonymous": comment.is_anonymous,
            "is_reply": comment.parent_id is not None,
            "surface": surface,
            "visibility": visibility,
        } for comment, surface, visibility in page],
        "next_cursor": f"{last.created_at.isoformat()}|{last.id}" if len(rows) > limit else None,
    }


@router.get("/stories/{post_id}/image")
def admin_story_image(
    post_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(admin_user),
):
    post = db.get(Post, post_id)
    if not post or not post.image_file or Path(post.image_file).name != post.image_file:
        raise HTTPException(404, "Image not found.")
    image = UPLOAD_DIR / "posts" / post.image_file
    if not image.is_file():
        raise HTTPException(404, "Image not found.")
    return FileResponse(image, headers={"Cache-Control": "private, no-store"})


@router.get("/match-explorer")
def admin_match_explorer(
    username: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(admin_user),
) -> dict:
    """Read-only preview of the live Same Sky matching rules for one account."""
    normalized = username.strip().removeprefix("@").lower()[:20]
    if not normalized:
        raise HTTPException(status_code=422, detail="Enter a username to inspect.")
    user = db.scalar(select(User).where(User.username_lower == normalized))
    if user is None:
        raise HTTPException(status_code=404, detail="No account found with that username.")

    rules = same_sky_rules(db)
    profile = db.scalar(select(SameSkyProfile).where(SameSkyProfile.user_id == user.id))
    source_stories = db.execute(
        select(Post, SameSkyAnalysis, SameSkyEmbedding)
        .join(SameSkyAnalysis, SameSkyAnalysis.post_id == Post.id)
        .join(SameSkyEmbedding, SameSkyEmbedding.post_id == Post.id)
        .where(
            SameSkyAnalysis.user_id == user.id,
            SameSkyAnalysis.processing_status == "ready",
            SameSkyAnalysis.duplicate_status.in_(ELIGIBLE_ENTRY_STATUSES),
            SameSkyEmbedding.embedding_model == settings.gemini_embedding_model,
            SameSkyEmbedding.embedding_version == settings.gemini_embedding_version,
        )
    ).all()
    ready_posts = sum(1 for _, analysis, _ in source_stories if analysis.entry_type == "experience")
    ready_confessions = sum(1 for _, analysis, _ in source_stories if analysis.entry_type == "confession")
    raw_statuses = db.execute(
        select(SameSkyAnalysis.processing_status, func.count(SameSkyAnalysis.post_id))
        .where(SameSkyAnalysis.user_id == user.id)
        .group_by(SameSkyAnalysis.processing_status)
    ).all()
    status_counts = {status: count for status, count in raw_statuses}
    ready_missing_embedding = db.scalar(
        select(func.count(SameSkyAnalysis.post_id))
        .outerjoin(SameSkyEmbedding, SameSkyEmbedding.post_id == SameSkyAnalysis.post_id)
        .where(
            SameSkyAnalysis.user_id == user.id,
            SameSkyAnalysis.processing_status == "ready",
            or_(
                SameSkyEmbedding.post_id.is_(None),
                SameSkyEmbedding.embedding_model != settings.gemini_embedding_model,
                SameSkyEmbedding.embedding_version != settings.gemini_embedding_version,
            ),
        )
    ) or 0
    job_statuses = db.execute(text("""
        SELECT j.status, count(*)
        FROM same_sky_jobs AS j
        JOIN same_sky_analysis AS a ON j.payload->>'post_id' = a.post_id::text
        WHERE j.job_type = 'analyze_post' AND a.user_id = :user_id
        GROUP BY j.status
    """), {"user_id": str(user.id)}).all()
    profile_ready = bool(
        profile
        and ready_posts >= rules[REQUIRED_POSTS]
        and ready_confessions >= rules[REQUIRED_CONFESSIONS]
    )

    matches_by_other_user: dict[uuid.UUID, SameSkyMatch] = {}
    for m in db.scalars(select(SameSkyMatch).where(
        or_(SameSkyMatch.user_a_id == user.id, SameSkyMatch.user_b_id == user.id),
    )).all():
        other_id = m.user_b_id if m.user_a_id == user.id else m.user_a_id
        matches_by_other_user[other_id] = m

    blocked = set(db.scalars(select(UserBlock.blocked_id).where(UserBlock.blocker_id == user.id)).all())
    blocked.update(db.scalars(select(UserBlock.blocker_id).where(UserBlock.blocked_id == user.id)).all())

    # For admin diagnostics, do not exclude users who are already paired or blocked.
    # The admin needs full visibility into match scores and data regardless of user-facing constraints.
    pairs: dict[uuid.UUID, list[tuple[uuid.UUID, uuid.UUID, float]]] = {}
    evaluated = 0
    nearest_exclusions: dict[uuid.UUID, dict] = {}
    for source_post, _source_analysis, source_embedding in source_stories:
        neighbours = db.execute(
            select(
                Post,
                SameSkyAnalysis,
                SameSkyEmbedding,
                SameSkyEmbedding.embedding.cosine_distance(source_embedding.embedding).label("distance"),
            )
            .join(SameSkyAnalysis, SameSkyAnalysis.post_id == Post.id)
            .join(SameSkyEmbedding, SameSkyEmbedding.post_id == Post.id)
            .where(
                SameSkyAnalysis.user_id != user.id,
                SameSkyAnalysis.processing_status == "ready",
                SameSkyAnalysis.duplicate_status.in_(ELIGIBLE_ENTRY_STATUSES),
                SameSkyEmbedding.embedding_model == settings.gemini_embedding_model,
                SameSkyEmbedding.embedding_version == settings.gemini_embedding_version,
            )
            .order_by(SameSkyEmbedding.embedding.cosine_distance(source_embedding.embedding))
        ).all()
        for candidate_post, candidate_analysis, _embedding, distance in neighbours:
            evaluated += 1
            similarity = max(0.0, min(1.0, 1 - float(distance)))
            pairs.setdefault(candidate_analysis.user_id, []).append(
                (source_post.id, candidate_post.id, similarity)
            )

        diagnostic_neighbours = db.execute(
            select(
                User,
                SameSkyAnalysis,
                SameSkyProfile,
                SameSkyEmbedding.embedding.cosine_distance(source_embedding.embedding).label("distance"),
            )
            .join(SameSkyAnalysis, SameSkyAnalysis.user_id == User.id)
            .join(SameSkyEmbedding, SameSkyEmbedding.post_id == SameSkyAnalysis.post_id)
            .outerjoin(SameSkyProfile, SameSkyProfile.user_id == User.id)
            .where(
                User.id != user.id,
                SameSkyEmbedding.embedding_model == settings.gemini_embedding_model,
                SameSkyEmbedding.embedding_version == settings.gemini_embedding_version,
            )
            .order_by(SameSkyEmbedding.embedding.cosine_distance(source_embedding.embedding))
            .limit(80)
        ).all()
        for candidate_user, candidate_analysis, candidate_profile, distance in diagnostic_neighbours:
            candidate_id = candidate_user.id
            if candidate_id in pairs:
                continue
            similarity = max(0.0, min(1.0, 1 - float(distance)))
            if candidate_analysis.processing_status != "ready" or candidate_analysis.duplicate_status not in ELIGIBLE_ENTRY_STATUSES:
                reason = "Nearest story is not cleared for matching"
            elif candidate_profile is None or not candidate_profile.matching_enabled:
                reason = "Matching is turned off"
            elif candidate_profile.eligibility_status != "eligible":
                reason = "Account has not met its readiness requirements"
            else:
                reason = "Outside the live candidate set"
            previous = nearest_exclusions.get(candidate_id)
            if previous is None or similarity > previous["similarity"]:
                nearest_exclusions[candidate_id] = {
                    "username": candidate_user.username,
                    "similarity": similarity,
                    "reason": reason,
                }

    candidate_ids = list(pairs)
    candidate_profiles = db.scalars(select(SameSkyProfile).where(
        SameSkyProfile.user_id.in_(candidate_ids)
    )).all() if candidate_ids else []
    candidate_profile_by_id = {item.user_id: item for item in candidate_profiles}
    candidate_themes: dict[uuid.UUID, set[str]] = {}
    candidate_categories: dict[uuid.UUID, set[str]] = {}
    for candidate_id in candidate_ids:
        rows = db.execute(
            select(Post, SameSkyAnalysis)
            .join(SameSkyAnalysis, SameSkyAnalysis.post_id == Post.id)
            .where(
                SameSkyAnalysis.user_id == candidate_id,
                SameSkyAnalysis.processing_status == "ready",
                SameSkyAnalysis.duplicate_status.in_(ELIGIBLE_ENTRY_STATUSES),
            )
        ).all()
        candidate_categories[candidate_id] = {post.category for post, _ in rows}
        candidate_themes[candidate_id] = {theme for _, analysis in rows for theme in analysis.themes}

    own_themes = {theme for _, analysis, _ in source_stories for theme in analysis.themes}
    own_categories = {post.category for post, _, _ in source_stories}
    own_preferences = set(profile.preferred_categories or []) if profile else set()
    candidates = []
    rejected_by_score = []
    for candidate_id, comparisons in pairs.items():
        candidate_profile = candidate_profile_by_id.get(candidate_id)
        score = score_candidate(
            comparisons,
            own_themes,
            candidate_themes.get(candidate_id, set()),
            own_categories,
            candidate_categories.get(candidate_id, set()),
            own_preferences,
            set(candidate_profile.preferred_categories or []) if candidate_profile else set(),
        )
        candidate_user = db.get(User, candidate_id)
        if candidate_user is None:
            continue
        existing_match = matches_by_other_user.get(candidate_id)
        if candidate_id in blocked:
            rel_status = "Blocked"
        elif existing_match:
            rel_status = f"Matched ({existing_match.status})"
        elif candidate_profile is None or not candidate_profile.matching_enabled:
            rel_status = "Matching off"
        elif candidate_profile.eligibility_status != "eligible":
            rel_status = "Ineligible"
        else:
            rel_status = "Available"

        record = {
            "username": candidate_user.username,
            "score": round(score["score"], 4),
            "semantic_similarity": round(score["semantic"], 4),
            "context_score": round(score["context"], 4),
            "consistency_score": round(score["consistency"], 4),
            "preference_fit": round(score["preference_fit"], 4),
            "shared_themes": score["shared_themes"],
            "story_comparisons": len(comparisons),
            "relationship_status": rel_status,
        }
        if score["passed"]:
            candidates.append(record)
        else:
            rejected_by_score.append({
                **record,
                "reason": "Below live scoring thresholds: " + ", ".join(score["rejection_reasons"]),
            })

    candidates.sort(key=lambda item: item["score"], reverse=True)
    rejected_by_score.sort(key=lambda item: item["semantic_similarity"], reverse=True)
    theme_counts: dict[str, dict] = {}
    context_counts: dict[str, int] = {}
    emotion_counts: dict[str, int] = {}
    for _, analysis, _ in source_stories:
        entry_type = "post" if analysis.entry_type == "experience" else "confession"
        for theme_key in analysis.themes or []:
            labels = safe_themes([theme_key])
            if not labels:
                continue
            label = labels[0]
            counts = theme_counts.setdefault(label, {"count": 0, "posts": 0, "confessions": 0})
            counts["count"] += 1
            counts["posts" if entry_type == "post" else "confessions"] += 1
        for context in (analysis.experience_context or "").split(","):
            context = context.strip()
            if context:
                context_counts[context] = context_counts.get(context, 0) + 1
        if analysis.emotional_context:
            emotion_counts[analysis.emotional_context] = emotion_counts.get(analysis.emotional_context, 0) + 1

    shared_theme_candidate_counts: dict[str, int] = {}
    for candidate in candidates:
        for theme in candidate["shared_themes"]:
            shared_theme_candidate_counts[theme] = shared_theme_candidate_counts.get(theme, 0) + 1
    analysis_profile = {
        "eligible_story_count": len(source_stories),
        "themes": [
            {"label": label, **counts}
            for label, counts in sorted(theme_counts.items(), key=lambda item: (-item[1]["count"], item[0]))
        ],
        "contexts": [
            {"label": label.replace("_", " ").title(), "count": count}
            for label, count in sorted(context_counts.items(), key=lambda item: (-item[1], item[0]))
        ],
        "emotions": [
            {"label": label.replace("_", " ").title(), "count": count}
            for label, count in sorted(emotion_counts.items(), key=lambda item: (-item[1], item[0]))
        ],
        "candidate_overlap": [
            {"label": label, "candidate_count": count}
            for label, count in sorted(shared_theme_candidate_counts.items(), key=lambda item: (-item[1], item[0]))
        ],
    }
    for candidate_id in pairs:
        nearest_exclusions.pop(candidate_id, None)
    excluded = sorted(nearest_exclusions.values(), key=lambda item: item["similarity"], reverse=True)
    excluded = [
        {"username": item["username"], "similarity": round(item["similarity"], 4), "reason": item["reason"]}
        for item in excluded[:10]
    ]
    blockers = []
    if not profile:
        blockers.append("No Same Sky profile exists for this account.")
    if not profile or not profile.matching_enabled:
        blockers.append("Matching is turned off for this account.")
    if ready_posts < rules[REQUIRED_POSTS] or ready_confessions < rules[REQUIRED_CONFESSIONS]:
        blockers.append("The account has not reached its configured ready-story thresholds.")

    return {
        "target": {
            "username": user.username,
            "matching_enabled": bool(profile and profile.matching_enabled),
            "eligibility_status": profile.eligibility_status if profile else "not_started",
            "ready_posts": ready_posts,
            "required_posts": rules[REQUIRED_POSTS],
            "ready_confessions": ready_confessions,
            "required_confessions": rules[REQUIRED_CONFESSIONS],
            "analysis_status_counts": status_counts,
            "analysis_job_status_counts": {status: count for status, count in job_statuses},
            "ready_missing_embedding": ready_missing_embedding,
            "can_start_search": bool(profile and profile.matching_enabled and profile_ready),
            "analysis_profile": analysis_profile,
        },
        "preview_is_matchable": bool(profile and profile.matching_enabled and profile_ready),
        "blockers": blockers,
        "candidate_stories_evaluated": evaluated,
        "candidates": candidates,
        "below_threshold": rejected_by_score,
        "excluded_accounts": excluded,
    }


def admin_users_for_one(db: Session, user: User) -> dict:
    from app.models import Reaction, SameSkyAttempt

    profile = db.scalar(select(SameSkyProfile).where(SameSkyProfile.user_id == user.id))
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "joined_at": user.created_at,
        "last_login_at": user.last_login_at,
        "last_active_at": user.last_active_at,
        "posts_count": db.scalar(select(func.count(Post.id)).where(Post.author_id == user.id, Post.surface == "feed")) or 0,
        "confessions_count": db.scalar(select(func.count(Post.id)).where(Post.author_id == user.id, Post.surface == "confession")) or 0,
        "comments_count": db.scalar(select(func.count(Comment.id)).where(Comment.author_id == user.id, Comment.deleted_at.is_(None))) or 0,
        "reactions_count": db.scalar(select(func.count(Reaction.id)).where(Reaction.user_id == user.id)) or 0,
        "same_sky_selected": db.scalar(select(func.count(SameSkyAnalysis.post_id)).where(SameSkyAnalysis.user_id == user.id)) or 0,
        "same_sky_ready": db.scalar(select(func.count(SameSkyAnalysis.post_id)).where(SameSkyAnalysis.user_id == user.id, SameSkyAnalysis.processing_status == "ready")) or 0,
        "same_sky_eligibility": profile.eligibility_status if profile else "not_started",
        "same_sky_matching_enabled": bool(profile and profile.matching_enabled),
        "same_sky_attempts": db.scalar(select(func.count(SameSkyAttempt.id)).where(SameSkyAttempt.user_id == user.id)) or 0,
    }
