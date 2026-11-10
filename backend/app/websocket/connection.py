import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import WebSocket, WebSocketDisconnect

from app.websocket.events import make_event

logger = logging.getLogger(__name__)


class WebSocketConnection:
    """Represents a single authenticated WebSocket connection.

    Independent of specific domain features (chat, presence, notifications).
    """

    def __init__(self, websocket: WebSocket, user_id: UUID, metadata: dict[str, Any] | None = None) -> None:
        self.websocket = websocket
        self.user_id = user_id
        self.connection_id = str(uuid.uuid4())
        self.connected_at = datetime.now(timezone.utc)
        self.metadata = metadata or {}
        self.is_alive = True
        self._lock = asyncio.Lock()

    async def send_event(
        self,
        event: str,
        data: dict[str, Any] | None = None,
        event_id: str | None = None,
    ) -> bool:
        """Send a standardized JSON event to this connection.

        Returns True if sent successfully, False if disconnected or failed.
        """
        if not self.is_alive:
            return False

        payload = make_event(event=event, data=data, event_id=event_id)
        async with self._lock:
            try:
                await self.websocket.send_json(payload)
                return True
            except (WebSocketDisconnect, RuntimeError, ConnectionResetError) as err:
                logger.debug(
                    "WebSocket send failed for user %s on conn %s: %s",
                    self.user_id,
                    self.connection_id,
                    err,
                )
                self.is_alive = False
                return False
            except Exception as err:
                logger.warning(
                    "Unexpected error sending to user %s on conn %s: %s",
                    self.user_id,
                    self.connection_id,
                    err,
                )
                self.is_alive = False
                return False

    async def close(self, code: int = 1000, reason: str = "") -> None:
        """Safely close this WebSocket connection."""
        self.is_alive = False
        try:
            await self.websocket.close(code=code, reason=reason)
        except Exception:
            pass
