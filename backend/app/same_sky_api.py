"""Authenticated Same Sky Stage 9-1 endpoints. No messaging endpoints live here."""

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db, SessionLocal
from app.limiter import limit
from app.models import (
    SameSkyAnalysis,
    SameSkyAttempt,
    SameSkyEmbedding,
    SameSkyJob,
    SameSkyMatch,
    SameSkyProfile,
    Post,
    User,
    UserBlock,
)
from app.notification_service import NotificationEvent, notification_service
from app.schemas import (
    SameSkyAnalysisOut,
    SameSkyMatchResponseIn,
    SameSkyProfileOut,
    SameSkyProfileUpdate,
)
from app.security import read_user_id
from app.same_sky_common import (
    ensure_profile,
    enqueue_job,
    analysis_fingerprint,
    invalidate_matches,
    profile_response,
    update_eligibility,
)
from app.taxonomy import CATEGORY_SET

router = APIRouter(prefix="/same-sky", tags=["Same Sky"])


def signed_in_user(request: Request, db: Session = Depends(get_db)) -> User:
    try:
        user_id = read_user_id(request)
    except HTTPException:
        raise
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Log in again.")
    return user


def _timezone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=422, detail="Choose a valid IANA timezone, such as Asia/Kolkata.") from None


def _analysis_response(analysis: SameSkyAnalysis, post: Post) -> SameSkyAnalysisOut:
    return SameSkyAnalysisOut(
        post_id=post.id,
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


def _purge_post_analysis(db: Session, post_id: uuid.UUID, *, remove_record: bool = False) -> None:
    db.execute(delete(SameSkyEmbedding).where(SameSkyEmbedding.post_id == post_id))
    db.execute(delete(SameSkyJob).where(
        SameSkyJob.job_type == "analyze_post",
        SameSkyJob.payload["post_id"].as_string() == str(post_id),
        SameSkyJob.status == "queued",
    ))
    analysis = db.scalar(select(SameSkyAnalysis).where(SameSkyAnalysis.post_id == post_id).with_for_update())
    if analysis is None:
        return
    if remove_record:
        db.delete(analysis)
        return
    analysis.themes = []
    analysis.experience_context = ""
    analysis.safe_summary = ""
    analysis.emotional_context = ""
    analysis.copy_signal = "low"
    analysis.safety_flags = []
    analysis.model_name = ""


def include_post_for_matching(db: Session, user: User, post: Post) -> SameSkyAnalysis:
    """Create or refresh the analysis row linked directly to a normal post."""
    entry_type = "confession" if post.surface == "confession" else "experience"
    title = next((line.strip() for line in post.body.splitlines() if line.strip()), "My post")[:120]
    source_hash = analysis_fingerprint(entry_type, title, post.body, post.category, post.mood, None)
    profile = ensure_profile(db, user.id, lock=True)
    analysis = db.scalar(select(SameSkyAnalysis).where(SameSkyAnalysis.post_id == post.id).with_for_update())
    if analysis is None:
        analysis = SameSkyAnalysis(
            post_id=post.id,
            user_id=user.id,
            entry_type=entry_type,
            analysis_fingerprint=source_hash,
            processing_status="pending",
        )
        db.add(analysis)
    elif analysis.analysis_fingerprint == source_hash and analysis.processing_status in {"pending", "processing", "ready", "needs_revision", "needs_review"}:
        return analysis
    else:
        _purge_post_analysis(db, post.id)
        analysis.user_id = user.id
        analysis.entry_type = entry_type
        analysis.analysis_fingerprint = source_hash
        analysis.processing_status = "pending"
        analysis.duplicate_status = "clear"
        analysis.processing_error = None
    db.flush()
    enqueue_job(db, "analyze_post", {"post_id": str(post.id)})
    update_eligibility(db, profile)
    invalidate_matches(db, user.id)
    return analysis


@router.post("/posts/{post_id}/include", response_model=SameSkyAnalysisOut)
def include_existing_post(
    post_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(signed_in_user),
):
    """Queue an existing post for Same Sky analysis."""
    limit(request, "same-sky-post-include", max_hits=30, window_seconds=3600)
    post = db.scalar(select(Post).where(Post.id == post_id, Post.author_id == user.id).with_for_update())
    if post is None or post.surface not in {"feed", "confession"}:
        raise HTTPException(status_code=404, detail="That post is no longer available.")
    analysis = include_post_for_matching(db, user, post)
    db.commit()
    db.refresh(analysis)
    return _analysis_response(analysis, post)


@router.delete("/posts/{post_id}/include", status_code=status.HTTP_204_NO_CONTENT)
def exclude_existing_post(
    post_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(signed_in_user),
):
    """Remove a post from Same Sky without deleting the original post."""
    post_exists = db.scalar(select(Post.id).where(Post.id == post_id, Post.author_id == user.id))
    if post_exists is None:
        raise HTTPException(status_code=404, detail="That post is no longer available.")
    analysis = db.scalar(select(SameSkyAnalysis).where(
        SameSkyAnalysis.post_id == post_id,
        SameSkyAnalysis.user_id == user.id,
    ).with_for_update())
    if analysis is None:
        return None
    profile = ensure_profile(db, user.id, lock=True)
    _purge_post_analysis(db, post_id, remove_record=True)
    update_eligibility(db, profile)
    invalidate_matches(db, user.id)
    db.commit()
    return None


@router.get("", response_model=SameSkyProfileOut)
def get_same_sky(db: Session = Depends(get_db), user: User = Depends(signed_in_user)):
    result = profile_response(db, user)
    db.commit()
    return result


@router.patch("/profile", response_model=SameSkyProfileOut)
def update_same_sky_profile(
    body: SameSkyProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(signed_in_user),
):
    zone = _timezone(body.timezone)
    if any(category not in CATEGORY_SET for category in body.preferred_categories):
        raise HTTPException(status_code=422, detail="Choose categories from the list.")
    profile = ensure_profile(db, user.id, lock=True)
    profile.timezone = zone.key
    profile.matching_enabled = body.matching_enabled
    profile.preferred_categories = body.preferred_categories
    update_eligibility(db, profile)
    if not body.matching_enabled:
        invalidate_matches(db, user.id)
    db.commit()
    result = profile_response(db, user)
    db.commit()
    return result


@router.post("/posts/{post_id}/retry", response_model=SameSkyAnalysisOut, status_code=status.HTTP_202_ACCEPTED)
def retry_post_analysis(
    post_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(signed_in_user),
):
    limit(request, "same-sky-post-retry", max_hits=10, window_seconds=3600)
    analysis = db.scalar(select(SameSkyAnalysis).where(SameSkyAnalysis.post_id == post_id, SameSkyAnalysis.user_id == user.id).with_for_update())
    post = db.scalar(select(Post).where(Post.id == post_id, Post.author_id == user.id))
    if analysis is None or post is None:
        raise HTTPException(status_code=404, detail="That post is no longer available.")
    if analysis.processing_status not in {"failed", "needs_review", "reindex_required"}:
        raise HTTPException(status_code=409, detail="This post does not need another analysis attempt.")
    _purge_post_analysis(db, post_id)
    analysis.processing_status = "pending"
    analysis.processing_error = None
    enqueue_job(db, "analyze_post", {"post_id": str(post_id)})
    profile = ensure_profile(db, user.id, lock=True)
    db.flush()
    update_eligibility(db, profile)
    db.commit()
    db.refresh(analysis)
    return _analysis_response(analysis, post)


@router.post("/attempts", status_code=status.HTTP_202_ACCEPTED)
def start_matching_attempt(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(signed_in_user),
):
    # Lock the profile to serialize retries; the per-IP limit only throttles abuse.
    limit(request, "same-sky-attempt", max_hits=60, window_seconds=3600)
    profile = ensure_profile(db, user.id, lock=True)
    _, _, _, _, _, enough = update_eligibility(db, profile)
    if not enough:
        raise HTTPException(status_code=409, detail="Finish the initial experience collection before matching.")
    if not profile.matching_enabled:
        raise HTTPException(status_code=409, detail="Turn on Same Sky matching when you feel ready.")
    now = datetime.now(timezone.utc)
    if profile.next_attempt_at is not None and now < profile.next_attempt_at:
        raise HTTPException(status_code=429, detail="Your next matching attempt is not available yet.")
    active_attempt = db.scalar(select(SameSkyAttempt.id).where(
        SameSkyAttempt.user_id == user.id,
        SameSkyAttempt.status.in_(("queued", "searching")),
    ).limit(1))
    if active_attempt:
        raise HTTPException(status_code=409, detail="A matching search is already in progress.")
    zone = _timezone(profile.timezone)
    local_now = now.astimezone(zone)
    profile.last_attempt_at = now
    attempt = SameSkyAttempt(user_id=user.id, local_day=local_now.date(), status="queued")
    db.add(attempt)
    db.flush()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=429, detail="A matching search is already in progress.") from None

    # Run the match search immediately (pure local pgvector comparison, <50ms)
    from app.same_sky_matching import _find_match
    _find_match(attempt.id)
    with SessionLocal() as check_db:
        refreshed_attempt = check_db.get(SameSkyAttempt, attempt.id)
        refreshed_profile = check_db.scalar(select(SameSkyProfile).where(SameSkyProfile.user_id == user.id))
        return {
            "id": refreshed_attempt.id,
            "status": refreshed_attempt.status,
            "next_attempt_at": refreshed_profile.next_attempt_at if refreshed_profile else None,
            "match_id": refreshed_attempt.match_id,
        }


@router.get("/attempts/{attempt_id}")
def get_matching_attempt(
    attempt_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(signed_in_user),
):
    attempt = db.scalar(select(SameSkyAttempt).where(SameSkyAttempt.id == attempt_id, SameSkyAttempt.user_id == user.id))
    if attempt is None:
        raise HTTPException(status_code=404, detail="That matching attempt is gone.")
    return {
        "id": attempt.id,
        "status": attempt.status,
        "candidates_evaluated": attempt.candidates_evaluated,
        "match_id": attempt.match_id,
        "started_at": attempt.started_at,
        "completed_at": attempt.completed_at,
    }


@router.post("/matches/{match_id}/response")
def respond_to_match(
    match_id: uuid.UUID,
    body: SameSkyMatchResponseIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(signed_in_user),
):
    limit(request, "same-sky-match-response", max_hits=30, window_seconds=3600)
    accept = body.accept
    initial_match = db.scalar(select(SameSkyMatch).where(
        SameSkyMatch.id == match_id,
        or_(SameSkyMatch.user_a_id == user.id, SameSkyMatch.user_b_id == user.id),
    ))
    if initial_match is None or initial_match.status not in {"pending", "connected"}:
        raise HTTPException(status_code=404, detail="That match is no longer available.")
    user_a_id, user_b_id = initial_match.user_a_id, initial_match.user_b_id
    other_id = user_b_id if user_a_id == user.id else user_a_id
    profiles = db.scalars(select(SameSkyProfile).where(
        SameSkyProfile.user_id.in_([user_a_id, user_b_id]),
    ).order_by(SameSkyProfile.user_id).with_for_update()).all()
    match = db.scalar(select(SameSkyMatch).where(
        SameSkyMatch.id == match_id,
        or_(SameSkyMatch.user_a_id == user.id, SameSkyMatch.user_b_id == user.id),
    ).with_for_update())
    if match is None or match.status not in {"pending", "connected"}:
        raise HTTPException(status_code=404, detail="That match is no longer available.")
    blocked = db.scalar(select(UserBlock.id).where(
        or_(
            (UserBlock.blocker_id == user.id) & (UserBlock.blocked_id == other_id),
            (UserBlock.blocker_id == other_id) & (UserBlock.blocked_id == user.id),
        )
    ))
    if blocked:
        raise HTTPException(status_code=404, detail="That match is no longer available.")
    if match.status == "connected" and not accept:
        raise HTTPException(status_code=409, detail="Declining an accepted match is no longer available. Block or report this person instead.")
    if accept and (
        len(profiles) != 2
        or any(not item.matching_enabled or item.eligibility_status != "eligible" for item in profiles)
    ):
        match.status = "withdrawn"
        db.commit()
        raise HTTPException(status_code=409, detail="One person has paused matching, so this suggestion is no longer active.")
    current_user_accepted = match.accepted_by_a if match.user_a_id == user.id else match.accepted_by_b
    other_user_accepted = match.accepted_by_b if match.user_a_id == user.id else match.accepted_by_a
    if not accept:
        match.status = "declined"
        match.declined_by_id = user.id
        if other_user_accepted:
            notification_service.publish(db, NotificationEvent(
                recipient_id=other_id,
                actor_id=user.id,
                kind="same_sky_declined",
                same_sky_match_id=match.id,
            ))
    elif match.user_a_id == user.id:
        match.accepted_by_a = True
    else:
        match.accepted_by_b = True

    conversation_id = None
    if match.accepted_by_a and match.accepted_by_b:
        match.status = "connected"
        from app.chat.service import get_or_create_same_sky_conversation
        conv = get_or_create_same_sky_conversation(db, match.id, match.user_a_id, match.user_b_id)
        conversation_id = conv.id

    if accept and not current_user_accepted:
        notification_service.publish(db, NotificationEvent(
            recipient_id=other_id,
            actor_id=user.id,
            kind="same_sky_connected" if match.status == "connected" else "same_sky_request",
            same_sky_match_id=match.id,
        ))
    match.updated_at = datetime.now(timezone.utc)
    db.commit()

    if conversation_id:
        import asyncio
        from app.websocket.manager import ws_manager
        from app.websocket.events import SAME_SKY_CONNECTION_CREATED
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(ws_manager.send_to_users(
                [match.user_a_id, match.user_b_id],
                SAME_SKY_CONNECTION_CREATED,
                {"match_id": str(match.id), "conversation_id": str(conversation_id)},
            ))
        except RuntimeError:
            pass

    return {"id": match.id, "status": match.status, "conversation_id": conversation_id}


@router.post("/matches/{match_id}/reopen")
def reopen_declined_match(
    match_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(signed_in_user),
):
    """Let the person who declined reopen the request for a fresh response."""
    limit(request, "same-sky-match-reopen", max_hits=10, window_seconds=3600)
    initial_match = db.scalar(select(SameSkyMatch).where(
        SameSkyMatch.id == match_id,
        or_(SameSkyMatch.user_a_id == user.id, SameSkyMatch.user_b_id == user.id),
    ))
    if initial_match is None or initial_match.status != "declined":
        raise HTTPException(status_code=404, detail="That declined request is no longer available.")

    is_a = initial_match.user_a_id == user.id
    other_id = initial_match.user_b_id if is_a else initial_match.user_a_id
    profiles = db.scalars(select(SameSkyProfile).where(
        SameSkyProfile.user_id.in_([user.id, other_id]),
    ).order_by(SameSkyProfile.user_id).with_for_update()).all()
    match = db.scalar(select(SameSkyMatch).where(
        SameSkyMatch.id == match_id,
        or_(SameSkyMatch.user_a_id == user.id, SameSkyMatch.user_b_id == user.id),
    ).with_for_update())
    if match is None or match.status != "declined":
        raise HTTPException(status_code=404, detail="That declined request is no longer available.")

    if match.declined_by_id != user.id:
        raise HTTPException(status_code=403, detail="Only the person who declined can reopen this request.")

    if len(profiles) != 2 or any(
        not item.matching_enabled or item.eligibility_status != "eligible"
        for item in profiles
    ):
        raise HTTPException(status_code=409, detail="Both people need active, eligible Same Sky profiles to release this request again.")
    blocked = db.scalar(select(UserBlock.id).where(or_(
        (UserBlock.blocker_id == user.id) & (UserBlock.blocked_id == other_id),
        (UserBlock.blocker_id == other_id) & (UserBlock.blocked_id == user.id),
    )))
    if blocked:
        raise HTTPException(status_code=404, detail="That declined request is no longer available.")

    match.status = "pending"
    match.accepted_by_a = False
    match.accepted_by_b = False
    match.declined_by_id = None
    match.updated_at = datetime.now(timezone.utc)
    notification_service.publish(db, NotificationEvent(
        recipient_id=other_id,
        actor_id=user.id,
        kind="same_sky_reopened",
        same_sky_match_id=match.id,
    ))
    db.commit()
    return {"id": match.id, "status": match.status}
