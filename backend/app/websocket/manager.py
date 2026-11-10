import asyncio
import logging
from collections import defaultdict
from typing import Any, Iterable
from uuid import UUID

from fastapi import WebSocket

from app.websocket.broadcaster import BaseBroadcaster, InMemoryBroadcaster
from app.websocket.connection import WebSocketConnection
from app.websocket.events import PRESENCE_OFFLINE, PRESENCE_ONLINE

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages active WebSocket connections across all features in FMLCore.

    Supports:
    - Multiple connections per user (e.g. multiple tabs).
    - Targeted dispatch to specific users or lists of users.
    - Global broadcasting.
    - Presence querying.
    - Dead connection cleanup.
    - Pluggable broadcaster for multi-worker scaling.
    """

    def __init__(self, broadcaster: BaseBroadcaster | None = None) -> None:
        self._connections_by_user: dict[UUID, set[WebSocketConnection]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self.broadcaster = broadcaster or InMemoryBroadcaster()

    async def connect(
        self,
        websocket: WebSocket,
        user_id: UUID,
        metadata: dict[str, Any] | None = None,
    ) -> WebSocketConnection:
        """Register an accepted, authenticated connection."""
        conn = WebSocketConnection(websocket=websocket, user_id=user_id, metadata=metadata)
        async with self._lock:
            was_offline = len(self._connections_by_user[user_id]) == 0
            self._connections_by_user[user_id].add(conn)
        logger.info(
            "WebSocket connected: user %s, conn %s (total for user: %d)",
            user_id,
            conn.connection_id,
            len(self._connections_by_user[user_id]),
        )
        if was_offline:
            await self.broadcast(
                event=PRESENCE_ONLINE,
                data={"user_id": str(user_id)},
                exclude_user=user_id,
            )
        return conn

    async def disconnect(self, connection: WebSocketConnection) -> None:
        """Remove a connection and perform cleanup."""
        user_id = connection.user_id
        async with self._lock:
            conns = self._connections_by_user.get(user_id)
            if conns:
                conns.discard(connection)
                if not conns:
                    del self._connections_by_user[user_id]
            is_now_offline = len(self._connections_by_user.get(user_id, set())) == 0

        await connection.close()
        logger.info(
            "WebSocket disconnected: user %s, conn %s (remaining for user: %d)",
            user_id,
            connection.connection_id,
            len(self._connections_by_user.get(user_id, set())),
        )
        if is_now_offline:
            await self.broadcast(
                event=PRESENCE_OFFLINE,
                data={"user_id": str(user_id)},
                exclude_user=user_id,
            )

    async def disconnect_user(self, user_id: UUID) -> None:
        """Disconnect all connections for a given user."""
        async with self._lock:
            conns = list(self._connections_by_user.pop(user_id, set()))
        for conn in conns:
            await conn.close()
        await self.broadcast(
            event=PRESENCE_OFFLINE,
            data={"user_id": str(user_id)},
            exclude_user=user_id,
        )

    async def send_to_user(
        self,
        user_id: UUID,
        event: str,
        data: dict[str, Any] | None = None,
        event_id: str | None = None,
    ) -> int:
        """Send an event to all active connections belonging to a user.

        Returns the number of active connections that received the event.
        """
        async with self._lock:
            conns = list(self._connections_by_user.get(user_id, set()))

        if not conns:
            return 0

        stale: list[WebSocketConnection] = []
        sent_count = 0

        for conn in conns:
            ok = await conn.send_event(event=event, data=data, event_id=event_id)
            if ok:
                sent_count += 1
            else:
                stale.append(conn)

        if stale:
            async with self._lock:
                for bad_conn in stale:
                    if user_id in self._connections_by_user:
                        self._connections_by_user[user_id].discard(bad_conn)
                        if not self._connections_by_user[user_id]:
                            del self._connections_by_user[user_id]

        return sent_count

    async def send_to_users(
        self,
        user_ids: Iterable[UUID],
        event: str,
        data: dict[str, Any] | None = None,
        event_id: str | None = None,
    ) -> dict[UUID, int]:
        """Send an event to multiple users concurrently."""
        results: dict[UUID, int] = {}
        tasks = [
            self.send_to_user(user_id=uid, event=event, data=data, event_id=event_id)
            for uid in set(user_ids)
        ]
        counts = await asyncio.gather(*tasks, return_exceptions=True)
        for uid, count in zip(set(user_ids), counts):
            results[uid] = count if isinstance(count, int) else 0
        return results

    async def broadcast(
        self,
        event: str,
        data: dict[str, Any] | None = None,
        exclude_user: UUID | None = None,
    ) -> int:
        """Broadcast an event to all connected users."""
        async with self._lock:
            all_users = [uid for uid in self._connections_by_user.keys() if uid != exclude_user]

        results = await self.send_to_users(all_users, event, data)
        return sum(results.values())

    def is_user_online(self, user_id: UUID) -> bool:
        """Check if a user has at least one active connection."""
        return user_id in self._connections_by_user and len(self._connections_by_user[user_id]) > 0

    def get_online_users(self, user_ids: Iterable[UUID]) -> set[UUID]:
        """Filter a collection of user IDs to those currently online."""
        return {uid for uid in user_ids if self.is_user_online(uid)}

    def active_connection_count(self) -> int:
        """Return the total number of open WebSocket connections."""
        return sum(len(c) for c in self._connections_by_user.values())

    def online_user_count(self) -> int:
        """Return the number of distinct authenticated users connected."""
        return len(self._connections_by_user)


# Global WebSocketManager singleton instance
ws_manager = WebSocketManager()
