"""Shared Same Sky eligibility and serialization helpers."""

import hashlib
import hmac
import uuid
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Post, SameSkyAnalysis, SameSkyAttempt, SameSkyEmbedding, SameSkyMatch, SameSkyProfile, User, UserBlock
from app.system_settings import REQUIRED_CONFESSIONS, REQUIRED_POSTS, same_sky_rules
from app.schemas import (
    SameSkyAttemptOut,
    SameSkyAnalysisOut,
    SameSkyMatchOut,
    SameSkyProfileOut,
    SameSkyPublicPersonOut,
)

ELIGIBLE_ENTRY_STATUSES = ("clear", "appealed")


def ensure_profile(db: Session, user_id: uuid.UUID, *, lock: bool = False) -> SameSkyProfile:
    db.execute(insert(SameSkyProfile).values(user_id=user_id).on_conflict_do_nothing(index_elements=["user_id"]))
    query = select(SameSkyProfile).where(SameSkyProfile.user_id == user_id)
    if lock:
        query = query.with_for_update()
    return db.scalar(query)


def fingerprint(title: str, description: str) -> str:
    normalized = " ".join(f"{title}\n{description}".casefold().split())
    return hmac.new(
        settings.same_sky_fingerprint_secret.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def analysis_fingerprint(entry_type: str, title: str, description: str, category: str, mood: str | None, reflection: str | None) -> str:
    normalized = "\n".join(" ".join((value or "").casefold().split()) for value in (
        entry_type, title, description, category, mood, reflection,
    ))
    return hmac.new(
        settings.same_sky_fingerprint_secret.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def enqueue_job(db: Session, job_type: str, payload: dict) -> None:
    from app.models import SameSkyJob
    from sqlalchemy import text
    db.add(SameSkyJob(job_type=job_type, payload=payload, status="queued"))
    db.execute(text("NOTIFY same_sky_jobs;"))


def invalidate_matches(db: Session, user_id: uuid.UUID) -> None:
    rows = db.scalars(select(SameSkyMatch).where(
        or_(SameSkyMatch.user_a_id == user_id, SameSkyMatch.user_b_id == user_id),
        SameSkyMatch.status.in_(("pending", "connected")),
    ).with_for_update()).all()
    now = datetime.now(timezone.utc)
    for match in rows:
        if match.status == "pending":
            match.status = "withdrawn"
        else:
            match.shared_themes = []
            match.safe_explanation = "You both chose to connect. Shared theme labels have been removed."
            match.similarity_score = 0.0
        match.updated_at = now


def update_eligibility(
    db: Session,
    profile: SameSkyProfile,
    rules: dict[str, int] | None = None,
) -> tuple[int, int, int, int, int, int]:
    rules = rules or same_sky_rules(db)
    analyses = db.scalars(select(SameSkyAnalysis).where(
        SameSkyAnalysis.user_id == profile.user_id,
    )).all()
    current_vectors = set(db.scalars(select(SameSkyEmbedding.post_id).where(
        SameSkyEmbedding.user_id == profile.user_id,
        SameSkyEmbedding.embedding_model == settings.gemini_embedding_model,
        SameSkyEmbedding.embedding_version == settings.gemini_embedding_version,
    )).all())
    exp_total = conf_total = exp_ready = conf_ready = pending = 0
    for analysis in analyses:
        if analysis.entry_type == "experience":
            exp_total += 1
        else:
            conf_total += 1
        if analysis.processing_status == "ready" and analysis.duplicate_status in ELIGIBLE_ENTRY_STATUSES and analysis.post_id in current_vectors:
            if analysis.entry_type == "experience":
                exp_ready += 1
            else:
                conf_ready += 1
        elif analysis.processing_status in {"pending", "processing", "reindex_required"}:
            pending += 1
    enough = exp_ready >= rules[REQUIRED_POSTS] and conf_ready >= rules[REQUIRED_CONFESSIONS]
    profile.eligibility_status = "eligible" if enough else ("processing" if pending else "collecting")
    return exp_total, conf_total, exp_ready, conf_ready, pending, int(enough)


def _match_out(match: SameSkyMatch, user: User, other_user: User) -> SameSkyMatchOut:
    is_a = match.user_a_id == user.id
    return SameSkyMatchOut(
        id=match.id,
        status=match.status,
        person=SameSkyPublicPersonOut(
            id=other_user.id,
            username=other_user.username,
            bio=other_user.bio,
            profile_color=other_user.profile_color,
            profile_sticker=other_user.profile_sticker,
            avatar_url=f"/media/avatars/{other_user.avatar_file}" if other_user.avatar_file else None,
        ),
        shared_themes=match.shared_themes or [],
        safe_explanation=match.safe_explanation,
        you_accepted=match.accepted_by_a if is_a else match.accepted_by_b,
        they_accepted=match.accepted_by_b if is_a else match.accepted_by_a,
        created_at=match.created_at,
    )


def profile_response(db: Session, user: User) -> SameSkyProfileOut:
    profile = ensure_profile(db, user.id)
    rules = same_sky_rules(db)
    exp_total, conf_total, exp_ready, conf_ready, _, _ = update_eligibility(db, profile, rules)
    analysis_posts = db.execute(
        select(SameSkyAnalysis, Post)
        .join(Post, Post.id == SameSkyAnalysis.post_id)
        .where(SameSkyAnalysis.user_id == user.id)
        .order_by(SameSkyAnalysis.created_at.desc())
    ).all()
    current_vectors = set(db.scalars(select(SameSkyEmbedding.post_id).where(
        SameSkyEmbedding.user_id == user.id,
        SameSkyEmbedding.embedding_model == settings.gemini_embedding_model,
        SameSkyEmbedding.embedding_version == settings.gemini_embedding_version,
    )).all())
    for analysis, _post in analysis_posts:
        if analysis.processing_status == "ready" and analysis.post_id not in current_vectors:
            analysis.processing_status = "reindex_required"
    matches = db.scalars(
        select(SameSkyMatch)
        .where(
            ((SameSkyMatch.user_a_id == user.id) | (SameSkyMatch.user_b_id == user.id)),
            SameSkyMatch.status.in_(("pending", "connected")),
        )
        .order_by(SameSkyMatch.created_at.desc())
        .limit(30)
    ).all()
    declined_matches = db.scalars(
        select(SameSkyMatch)
        .where(
            ((SameSkyMatch.user_a_id == user.id) | (SameSkyMatch.user_b_id == user.id)),
            SameSkyMatch.status == "declined",
            SameSkyMatch.declined_by_id == user.id,
        )
        .order_by(SameSkyMatch.updated_at.desc())
        .limit(20)
    ).all()
    blocked_ids = set(db.scalars(select(UserBlock.blocked_id).where(UserBlock.blocker_id == user.id)).all())
    blocked_ids.update(db.scalars(select(UserBlock.blocker_id).where(UserBlock.blocked_id == user.id)).all())
    person_ids = {
        m.user_b_id if m.user_a_id == user.id else m.user_a_id
        for m in [*matches, *declined_matches]
    }
    person_ids -= blocked_ids
    people = {p.id: p for p in db.scalars(select(User).where(User.id.in_(person_ids))).all()} if person_ids else {}
    result_matches = []
    for match in matches:
        other_id = match.user_b_id if match.user_a_id == user.id else match.user_a_id
        if other_id in blocked_ids:
            continue
        other_user = people.get(other_id)
        if other_user is not None:
            result_matches.append(_match_out(match, user, other_user))
    result_declined_matches = []
    for match in declined_matches:
        other_id = match.user_b_id if match.user_a_id == user.id else match.user_a_id
        if other_id in blocked_ids:
            continue
        other_user = people.get(other_id)
        if other_user is not None:
            result_declined_matches.append(_match_out(match, user, other_user))
    attempt = db.scalar(
        select(SameSkyAttempt).where(SameSkyAttempt.user_id == user.id).order_by(SameSkyAttempt.started_at.desc()).limit(1)
    )
    latest_match = db.get(SameSkyMatch, attempt.match_id) if attempt and attempt.match_id else None
    db.flush()
    return SameSkyProfileOut(
        analyses=[
            SameSkyAnalysisOut(
                post_id=analysis.post_id,
                entry_type=analysis.entry_type,
                title=next((line.strip() for line in post.body.splitlines() if line.strip()), "My post")[:120],
                description=post.body,
                category=post.category,
                mood=post.mood,
                processing_status=analysis.processing_status,
                duplicate_status=analysis.duplicate_status,
                created_at=analysis.created_at,
                updated_at=analysis.updated_at,
            )
            for analysis, post in analysis_posts
        ],
        matches=result_matches,
        declined_matches=result_declined_matches,
        latest_attempt=SameSkyAttemptOut.model_validate(attempt, from_attributes=True) if attempt else None,
        latest_match_status=latest_match.status if latest_match else None,
        experience_count=exp_total,
        confession_count=conf_total,
        ready_experience_count=exp_ready,
        ready_confession_count=conf_ready,
        required_experiences=rules[REQUIRED_POSTS],
        required_confessions=rules[REQUIRED_CONFESSIONS],
        eligibility_status=profile.eligibility_status,
        matching_enabled=profile.matching_enabled,
        preferred_categories=profile.preferred_categories or [],
        timezone=profile.timezone,
        last_attempt_at=profile.last_attempt_at,
        next_attempt_at=profile.next_attempt_at,
    )
