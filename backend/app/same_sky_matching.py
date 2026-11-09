"""Analyze newly created posts and find matches from stored Same Sky data."""

import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

import psycopg

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import (
    Post,
    SameSkyAnalysis,
    SameSkyAttempt,
    SameSkyEmbedding,
    SameSkyJob,
    SameSkyMatch,
    SameSkyProfile,
    UserBlock,
)
from app.same_sky_ai import ProviderRequestError, analyze_story, compare_for_copying, embed_text, safe_themes
from app.same_sky_common import ELIGIBLE_ENTRY_STATUSES, invalidate_matches, update_eligibility
from app.same_sky_scoring import score_candidate
from app.system_settings import REQUIRED_CONFESSIONS, REQUIRED_POSTS, RETRY_MINUTES, same_sky_ai_provider, same_sky_rules

logger = logging.getLogger("fmlcore.same_sky")
MAX_JOB_ATTEMPTS = 6


def _story_payload(post: Post, analysis: SameSkyAnalysis) -> dict:
    title = next((line.strip() for line in post.body.splitlines() if line.strip()), "My post")[:120]
    return {
        "id": str(post.id),
        "post_id": str(post.id),
        "user_id": str(post.author_id),
        "entry_type": analysis.entry_type,
        "title": title,
        "description": post.body,
        "category": post.category,
        "mood": post.mood,
        "reflection": None,
        "analysis_fingerprint": analysis.analysis_fingerprint,
    }


def _analyze_post(post_id: uuid.UUID, provider: str) -> None:
    with SessionLocal() as db:
        analysis = db.scalar(
            select(SameSkyAnalysis).where(SameSkyAnalysis.post_id == post_id).with_for_update()
        )
        post = db.get(Post, post_id)
        if analysis is None or post is None:
            return
        fingerprint = analysis.analysis_fingerprint
        analysis.processing_status = "processing"
        analysis.processing_error = None
        payload = _story_payload(post, analysis)
        db.commit()

    result, analysis_model = analyze_story(payload, provider)
    if not result.themes or not result.contexts:
        raise RuntimeError("The providers could not find enough usable context in this post.")
    theme_labels = safe_themes(result.themes)
    summary_for_embedding = " | ".join([
        payload["entry_type"], payload["category"], *theme_labels, *result.contexts,
        result.safe_summary,
    ])
    vector = embed_text(summary_for_embedding)

    # A provider's standalone copy signal is not enough to block a story.
    # Duplicate validation happens here, against a highly similar existing
    # story, with the selected provider comparing the pair.
    duplicate_review = False
    safety_review = bool(result.risk_flags) and not duplicate_review

    if not safety_review:
        with SessionLocal() as db:
            exact_duplicate = db.scalar(
                select(SameSkyAnalysis.post_id)
                .where(
                    SameSkyAnalysis.analysis_fingerprint == fingerprint,
                    SameSkyAnalysis.user_id != uuid.UUID(payload["user_id"]),
                    SameSkyAnalysis.post_id != post_id,
                )
                .limit(1)
            )
            nearest = None if exact_duplicate else db.execute(
                select(
                    Post,
                    SameSkyAnalysis,
                    SameSkyEmbedding.embedding.cosine_distance(vector).label("distance"),
                )
                .join(SameSkyAnalysis, SameSkyAnalysis.post_id == Post.id)
                .join(SameSkyEmbedding, SameSkyEmbedding.post_id == Post.id)
                .where(
                    SameSkyAnalysis.user_id != uuid.UUID(payload["user_id"]),
                    SameSkyEmbedding.embedding_model == settings.gemini_embedding_model,
                    SameSkyEmbedding.embedding_version == settings.gemini_embedding_version,
                )
                .order_by(SameSkyEmbedding.embedding.cosine_distance(vector))
                .limit(1)
            ).first()
            if exact_duplicate:
                duplicate_review = True
            elif nearest:
                other_post, other_analysis, distance = nearest
                if 1 - float(distance) >= 0.94:
                    comparison, _ = compare_for_copying(
                        payload, _story_payload(other_post, other_analysis), provider
                    )
                    duplicate_review = comparison.likely_copy

    with SessionLocal() as db:
        analysis = db.scalar(
            select(SameSkyAnalysis).where(SameSkyAnalysis.post_id == post_id).with_for_update()
        )
        post = db.get(Post, post_id)
        if (
            analysis is None or post is None
            or analysis.analysis_fingerprint != fingerprint
        ):
            return
        analysis.themes = result.themes
        analysis.experience_context = ",".join(result.contexts)[:80]
        analysis.safe_summary = result.safe_summary
        analysis.emotional_context = result.emotion
        analysis.copy_signal = result.copy_signal
        analysis.safety_flags = result.risk_flags
        analysis.model_name = analysis_model
        embedding = db.scalar(
            select(SameSkyEmbedding).where(SameSkyEmbedding.post_id == post_id).with_for_update()
        )
        if embedding is None:
            embedding = SameSkyEmbedding(
                post_id=post_id,
                user_id=post.author_id,
                embedding=vector,
                embedding_model=settings.gemini_embedding_model,
                embedding_version=settings.gemini_embedding_version,
                content_fingerprint=fingerprint,
            )
            db.add(embedding)
        else:
            embedding.user_id = post.author_id
            embedding.embedding = vector
            embedding.embedding_model = settings.gemini_embedding_model
            embedding.embedding_version = settings.gemini_embedding_version
            embedding.content_fingerprint = fingerprint
        if duplicate_review:
            analysis.duplicate_status = "review"
            analysis.processing_status = "needs_revision"
        elif safety_review:
            analysis.processing_status = "needs_review"
        else:
            analysis.duplicate_status = "clear"
            analysis.processing_status = "ready"
        analysis.processing_error = None
        profile = db.scalar(
            select(SameSkyProfile).where(SameSkyProfile.user_id == post.author_id).with_for_update()
        )
        db.flush()
        if profile is not None:
            update_eligibility(db, profile)
        invalidate_matches(db, post.author_id)
        db.commit()


def _user_stories(
    db: Session, user_id: uuid.UUID
) -> list[tuple[Post, SameSkyAnalysis, SameSkyEmbedding]]:
    return db.execute(
        select(Post, SameSkyAnalysis, SameSkyEmbedding)
        .join(SameSkyAnalysis, SameSkyAnalysis.post_id == Post.id)
        .join(SameSkyEmbedding, SameSkyEmbedding.post_id == Post.id)
        .where(
            SameSkyAnalysis.user_id == user_id,
            SameSkyAnalysis.processing_status == "ready",
            SameSkyAnalysis.duplicate_status.in_(ELIGIBLE_ENTRY_STATUSES),
            SameSkyEmbedding.embedding_model == settings.gemini_embedding_model,
            SameSkyEmbedding.embedding_version == settings.gemini_embedding_version,
        )
    ).all()


def _find_match(attempt_id: uuid.UUID) -> None:
    with SessionLocal() as db:
        attempt = db.scalar(select(SameSkyAttempt).where(
            SameSkyAttempt.id == attempt_id
        ).with_for_update())
        if attempt is None or attempt.status not in {"queued", "searching"}:
            return
        attempt.status = "searching"
        user_id = attempt.user_id
        db.commit()

    with SessionLocal() as db:
        profile = db.scalar(select(SameSkyProfile).where(SameSkyProfile.user_id == user_id))
        rules = same_sky_rules(db)
        user_stories = _user_stories(db, user_id)
        if profile is None or not profile.matching_enabled:
            return _finish_attempt(db, attempt_id, "unavailable", 0)
        post_count = sum(1 for _, analysis, _ in user_stories if analysis.entry_type == "experience")
        confession_count = sum(1 for _, analysis, _ in user_stories if analysis.entry_type == "confession")
        if post_count < rules[REQUIRED_POSTS] or confession_count < rules[REQUIRED_CONFESSIONS]:
            return _finish_attempt(db, attempt_id, "not_eligible", 0)

        already_matched = set()
        seen_pairs = db.execute(select(SameSkyMatch.user_a_id, SameSkyMatch.user_b_id).where(
            or_(SameSkyMatch.user_a_id == user_id, SameSkyMatch.user_b_id == user_id),
        )).all()
        for a_id, b_id in seen_pairs:
            already_matched.add(b_id if a_id == user_id else a_id)
        blocked = set(db.scalars(select(UserBlock.blocked_id).where(
            UserBlock.blocker_id == user_id
        )).all())
        blocked.update(db.scalars(select(UserBlock.blocker_id).where(
            UserBlock.blocked_id == user_id
        )).all())
        excluded = already_matched | blocked | {user_id}

        pairs: dict[uuid.UUID, list[tuple[uuid.UUID, uuid.UUID, float]]] = {}
        evaluated = 0
        for source_post, _source_analysis, source_embedding in user_stories:
            neighbours = db.execute(
                select(
                    Post,
                    SameSkyAnalysis,
                    SameSkyEmbedding,
                    SameSkyEmbedding.embedding.cosine_distance(
                        source_embedding.embedding
                    ).label("distance"),
                )
                .join(SameSkyAnalysis, SameSkyAnalysis.post_id == Post.id)
                .join(SameSkyEmbedding, SameSkyEmbedding.post_id == Post.id)
                .join(SameSkyProfile, SameSkyProfile.user_id == SameSkyAnalysis.user_id)
                .where(
                    SameSkyAnalysis.user_id.not_in(excluded),
                    SameSkyAnalysis.processing_status == "ready",
                    SameSkyAnalysis.duplicate_status.in_(ELIGIBLE_ENTRY_STATUSES),
                    SameSkyProfile.matching_enabled.is_(True),
                    SameSkyProfile.eligibility_status == "eligible",
                    SameSkyEmbedding.embedding_model == settings.gemini_embedding_model,
                    SameSkyEmbedding.embedding_version == settings.gemini_embedding_version,
                )
                .order_by(SameSkyEmbedding.embedding.cosine_distance(source_embedding.embedding))
                .limit(180)
            ).all()
            for candidate_post, candidate_analysis, _embedding, distance in neighbours:
                evaluated += 1
                similarity = max(0.0, min(1.0, 1 - float(distance)))
                pairs.setdefault(candidate_analysis.user_id, []).append(
                    (source_post.id, candidate_post.id, similarity)
                )
        if not pairs:
            return _finish_attempt(db, attempt_id, "no_match", evaluated)

        candidate_profiles = db.scalars(select(SameSkyProfile).where(
            SameSkyProfile.user_id.in_(pairs)
        )).all()
        candidate_profile_by_id = {item.user_id: item for item in candidate_profiles}

        candidate_categories: dict[uuid.UUID, set[str]] = {}
        candidate_themes: dict[uuid.UUID, set[str]] = {}
        for candidate_id in pairs:
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
            candidate_themes[candidate_id] = {
                theme for _, analysis in rows for theme in analysis.themes
            }

        own_categories = {post.category for post, _, _ in user_stories}
        own_themes = {theme for _, analysis, _ in user_stories for theme in analysis.themes}
        own_preferences = set(profile.preferred_categories or [])
        scored: list[tuple[float, uuid.UUID, list[str], str]] = []
        for candidate_id, comparisons in pairs.items():
            candidate_profile = candidate_profile_by_id.get(candidate_id)
            their_preferences = set(candidate_profile.preferred_categories or []) if candidate_profile else set()
            candidate_score = score_candidate(
                comparisons,
                own_themes,
                candidate_themes.get(candidate_id, set()),
                own_categories,
                candidate_categories.get(candidate_id, set()),
                own_preferences,
                their_preferences,
            )
            if not candidate_score["passed"]:
                continue
            scored.append((
                candidate_score["score"],
                candidate_id,
                candidate_score["shared_themes"] or ["A life change"],
                candidate_score["explanation"],
            ))

        for score, candidate_id, shared_themes, explanation in sorted(scored, reverse=True):
            refreshed = db.scalars(select(SameSkyProfile).where(
                SameSkyProfile.user_id.in_([user_id, candidate_id])
            ).order_by(SameSkyProfile.user_id).with_for_update()).all()
            if len(refreshed) != 2 or any(
                not item.matching_enabled or item.eligibility_status != "eligible"
                for item in refreshed
            ):
                continue
            a_id, b_id = sorted((user_id, candidate_id), key=lambda item: item.int)
            match = SameSkyMatch(
                user_a_id=a_id,
                user_b_id=b_id,
                initiated_by_id=user_id,
                similarity_score=score,
                shared_themes=shared_themes,
                safe_explanation=explanation,
            )
            db.add(match)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                continue
            attempt = db.get(SameSkyAttempt, attempt_id)
            attempt.status = "match_found"
            attempt.match_id = match.id
            attempt.candidates_evaluated = evaluated
            attempt.completed_at = datetime.now(timezone.utc)
            db.commit()
            return
        _finish_attempt(db, attempt_id, "no_match", evaluated)


def _finish_attempt(db: Session, attempt_id: uuid.UUID, status: str, evaluated: int) -> None:
    attempt = db.scalar(select(SameSkyAttempt).where(
        SameSkyAttempt.id == attempt_id
    ).with_for_update())
    if attempt is None:
        return
    attempt.status = status
    attempt.candidates_evaluated = evaluated
    attempt.completed_at = datetime.now(timezone.utc)
    if status == "no_match":
        profile = db.scalar(select(SameSkyProfile).where(
            SameSkyProfile.user_id == attempt.user_id,
        ).with_for_update())
        if profile is not None:
            rules = same_sky_rules(db)
            profile.next_attempt_at = attempt.completed_at + timedelta(
                minutes=rules[RETRY_MINUTES]
            )
    db.commit()


def _handle(job: SameSkyJob) -> None:
    payload = job.payload or {}
    if job.job_type == "analyze_post":
        _analyze_post(uuid.UUID(payload["post_id"]), payload["provider"])
    else:
        raise RuntimeError("Unknown Same Sky background job.")


def process_one_job() -> bool:
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        job = db.scalar(
            select(SameSkyJob)
            .where(
                or_(
                    and_(SameSkyJob.status == "queued", SameSkyJob.run_after <= now),
                    and_(SameSkyJob.status == "processing", SameSkyJob.locked_at < now - timedelta(minutes=4)),
                )
            )
            .order_by(SameSkyJob.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if job is None:
            return False
        job.status = "processing"
        job.locked_at = now
        job.attempts += 1
        job.last_error = None
        job_id = job.id
        provider = same_sky_ai_provider(db) if job.job_type == "analyze_post" else None
        payload = dict(job.payload or {})
        if provider:
            payload["provider"] = provider
        job_copy = SameSkyJob(job_type=job.job_type, payload=payload, id=job.id, attempts=job.attempts)
        db.commit()

    provider_ready = bool(
        settings.same_sky_gemini_ready
        and (provider != "groq" or settings.groq_api_key)
    )
    if job_copy.job_type == "analyze_post" and not provider_ready:
        with SessionLocal() as db:
            job = db.get(SameSkyJob, job_id)
            if job:
                job.status = "queued"
                job.locked_at = None
                job.run_after = datetime.now(timezone.utc) + timedelta(seconds=30)
                job.last_error = f"Waiting for configured {provider} analysis and Gemini embeddings."
                db.commit()
        return True

    try:
        _handle(job_copy)
        with SessionLocal() as db:
            job = db.get(SameSkyJob, job_id)
            if job:
                job.status = "complete"
                job.completed_at = datetime.now(timezone.utc)
                job.locked_at = None
                db.commit()
    except Exception as exc:
        logger.exception("Same Sky job failed (%s).", job_copy.job_type)
        with SessionLocal() as db:
            job = db.get(SameSkyJob, job_id)
            if job:
                job.last_error = str(exc)[:500]
                job.locked_at = None
                retryable = not isinstance(exc, ProviderRequestError) or exc.retryable
                if not retryable or job.attempts >= MAX_JOB_ATTEMPTS:
                    job.status = "failed"
                    job.completed_at = datetime.now(timezone.utc)
                    if job.job_type == "analyze_post":
                        post_id = (job.payload or {}).get("post_id")
                        analysis = db.get(SameSkyAnalysis, uuid.UUID(post_id)) if post_id else None
                        if analysis is not None:
                            analysis.processing_status = "failed"
                            analysis.processing_error = "We couldn't analyze this story. Please try again later."
                            profile = db.scalar(select(SameSkyProfile).where(
                                SameSkyProfile.user_id == analysis.user_id
                            ).with_for_update())
                            if profile:
                                update_eligibility(db, profile)
                else:
                    job.status = "queued"
                    backoff = min(30 * (2 ** job.attempts), 1800)
                    provider_wait = exc.retry_after_seconds if isinstance(exc, ProviderRequestError) else None
                    job.run_after = datetime.now(timezone.utc) + timedelta(
                        seconds=max(backoff, provider_wait or 0)
                    )
                db.commit()
    return True


def run_worker() -> None:
    logger.info("Same Sky event-driven worker started (PostgreSQL LISTEN/NOTIFY).")
    raw_url = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    # Drain any backlog on startup
    while process_one_job():
        pass
    while True:
        try:
            with psycopg.connect(raw_url, autocommit=True) as conn:
                conn.execute("LISTEN same_sky_jobs;")
                logger.info("Worker listening for Same Sky job events on channel 'same_sky_jobs'.")
                while True:
                    # Wait for PostgreSQL notification with a 60-second recovery timeout (0 SQL queries while idle)
                    for _ in conn.notifies(timeout=60.0, stop_after=1):
                        break
                    # Drain all available jobs
                    while process_one_job():
                        pass
        except Exception as exc:
            logger.warning("Notification connection error (%s); reconnecting in 5s...", exc)
            time.sleep(5.0)
