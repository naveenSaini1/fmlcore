import uuid

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Notification, UserBlock, UserMute


def hidden_author_ids(db: Session, user_id: uuid.UUID | None) -> set[uuid.UUID]:
    if user_id is None:
        return set()
    blocked = db.scalars(
        select(UserBlock.blocked_id).where(UserBlock.blocker_id == user_id)
    ).all()
    blocked_by = db.scalars(
        select(UserBlock.blocker_id).where(UserBlock.blocked_id == user_id)
    ).all()
    muted = db.scalars(select(UserMute.muted_id).where(UserMute.muter_id == user_id)).all()
    return set(blocked) | set(blocked_by) | set(muted)


def relationship_blocked(db: Session, first_id: uuid.UUID, second_id: uuid.UUID) -> bool:
    return db.scalar(
        select(UserBlock.id)
        .where(
            or_(
                (UserBlock.blocker_id == first_id) & (UserBlock.blocked_id == second_id),
                (UserBlock.blocker_id == second_id) & (UserBlock.blocked_id == first_id),
            )
        )
        .limit(1)
    ) is not None


def can_notify(db: Session, recipient_id: uuid.UUID, actor_id: uuid.UUID) -> bool:
    if recipient_id == actor_id or relationship_blocked(db, recipient_id, actor_id):
        return False
    return db.scalar(
        select(UserMute.id)
        .where(UserMute.muter_id == recipient_id, UserMute.muted_id == actor_id)
        .limit(1)
    ) is None


def queue_notification(
    db: Session,
    *,
    recipient_id: uuid.UUID,
    actor_id: uuid.UUID,
    kind: str,
    post_id: uuid.UUID | None,
    comment_id: uuid.UUID | None = None,
    actor_anonymous: bool = False,
) -> None:
    if can_notify(db, recipient_id, actor_id):
        db.add(
            Notification(
                recipient_id=recipient_id,
                actor_id=actor_id,
                kind=kind,
                post_id=post_id,
                comment_id=comment_id,
                same_sky_match_id=None,
                actor_anonymous=actor_anonymous,
            )
        )
