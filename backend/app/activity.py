"""Best-effort activity tracking for foreground requests."""
from collections import OrderedDict
import logging
from threading import BoundedSemaphore, Lock
from time import monotonic
from uuid import UUID

from fastapi import BackgroundTasks, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db import SessionLocal

logger = logging.getLogger(__name__)
INTERVAL_SECONDS = 15 * 60
MAX_RECENT_USERS = 20_000
_recent: OrderedDict[UUID, float] = OrderedDict()
_recent_lock = Lock()
_write_slots = BoundedSemaphore(2)

_FOREGROUND_READS = {
    "/posts", "/posts/{post_id}", "/confessions", "/leaderboard", "/me/posts",
    "/explore/random", "/confessions/random", "/users/{username}",
}
_ACTIVITY_WRITES = {"posts", "comments", "confessions", "profile", "same-sky", "safety"}


def schedule_activity(request: Request, tasks: BackgroundTasks, user_id: UUID) -> None:
    route = getattr(request.scope.get("route"), "path", "")
    if request.method == "GET":
        if route not in _FOREGROUND_READS:
            return
    else:
        group = route.split("/")[1] if route.startswith("/") else ""
        if request.method not in {"POST", "PATCH", "PUT", "DELETE"} or group not in _ACTIVITY_WRITES:
            return
    now = monotonic()
    with _recent_lock:
        if _recent.get(user_id, float("-inf")) > now - INTERVAL_SECONDS:
            return
        _recent[user_id] = now
        _recent.move_to_end(user_id)
        if len(_recent) > MAX_RECENT_USERS:
            _recent.popitem(last=False)
    tasks.add_task(record_activity, user_id)


def record_activity(user_id: UUID) -> None:
    if not _write_slots.acquire(blocking=False):
        return
    try:
        with SessionLocal.begin() as db:
            db.execute(text("SET LOCAL statement_timeout = '250ms'"))
            db.execute(text("""
                UPDATE users SET last_active_at = now()
                WHERE id = (
                    SELECT id FROM users
                    WHERE id = :user_id AND (
                        last_active_at IS NULL OR last_active_at <= now() - interval '15 minutes'
                    )
                    FOR UPDATE SKIP LOCKED
                )
            """), {"user_id": user_id})
    except SQLAlchemyError:
        logger.debug("Skipped account activity write", exc_info=True)
    finally:
        _write_slots.release()
