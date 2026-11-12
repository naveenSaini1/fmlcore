"""Push authoritative unread totals to every connection belonging to a user."""
import asyncio
from uuid import UUID
from weakref import WeakValueDictionary

from app.db import SessionLocal
from app.websocket.events import CHAT_UNREAD_COUNT
from app.websocket.manager import ws_manager

# Serialize snapshots for each user so an older query cannot overwrite a newer
# count. Locks disappear when no in-flight snapshot is using them.
_push_locks: WeakValueDictionary[UUID, asyncio.Lock] = WeakValueDictionary()


def unread_count(user_id: UUID) -> int:
    from app.chat.service import get_total_unread_count

    with SessionLocal() as db:
        return get_total_unread_count(db=db, user_id=user_id)


async def push_chat_unread(user_id: UUID) -> None:
    if not ws_manager.is_user_online(user_id):
        return
    lock = _push_locks.setdefault(user_id, asyncio.Lock())
    async with lock:
        count = await asyncio.to_thread(unread_count, user_id)
        await ws_manager.send_to_user(user_id, CHAT_UNREAD_COUNT, {"count": count})
