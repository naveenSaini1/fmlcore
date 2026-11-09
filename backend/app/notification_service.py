"""Notification event routing; delivery adapters can be added without changing feature routes."""

from dataclasses import dataclass
from typing import Protocol
import uuid

from sqlalchemy.orm import Session

from app.models import Notification
from app.safety import can_notify


@dataclass(frozen=True)
class NotificationEvent:
    recipient_id: uuid.UUID
    actor_id: uuid.UUID
    kind: str
    same_sky_match_id: uuid.UUID | None = None


class NotificationChannel(Protocol):
    def enqueue(self, db: Session, event: NotificationEvent) -> None: ...


class InAppNotificationChannel:
    """Persist an inbox item in the same transaction as its triggering action."""

    def enqueue(self, db: Session, event: NotificationEvent) -> None:
        if not can_notify(db, event.recipient_id, event.actor_id):
            return
        db.add(Notification(
            recipient_id=event.recipient_id,
            actor_id=event.actor_id,
            kind=event.kind,
            same_sky_match_id=event.same_sky_match_id,
        ))


class NotificationService:
    """Routes one feature event to configured delivery channels.

    Future email and mobile-push adapters can enqueue their own durable delivery
    jobs here while keeping feature routes independent of provider details.
    """

    def __init__(self, channels: tuple[NotificationChannel, ...]):
        self.channels = channels

    def publish(self, db: Session, event: NotificationEvent) -> None:
        for channel in self.channels:
            channel.enqueue(db, event)


notification_service = NotificationService((InAppNotificationChannel(),))
