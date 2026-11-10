import asyncio
import logging
from typing import Any, Callable, Coroutine

from app.websocket.connection import WebSocketConnection
from app.websocket.events import CONNECTION_ERROR, make_event

logger = logging.getLogger(__name__)

HandlerType = Callable[[WebSocketConnection, dict[str, Any], str], Coroutine[Any, Any, None]]


class WebSocketRouter:
    """Routes incoming WebSocket events to registered feature handlers."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[HandlerType]] = {}

    def register(self, event: str, handler: HandlerType) -> None:
        """Register an event handler for a given event name."""
        if event not in self._handlers:
            self._handlers[event] = []
        self._handlers[event].append(handler)
        logger.debug("Registered WS handler for event: %s", event)

    def on(self, event: str) -> Callable[[HandlerType], HandlerType]:
        """Decorator to register an event handler."""
        def decorator(handler: HandlerType) -> HandlerType:
            self.register(event, handler)
            return handler
        return decorator

    async def dispatch(
        self,
        connection: WebSocketConnection,
        event: str,
        data: dict[str, Any],
        event_id: str,
    ) -> None:
        """Dispatch an event to all matching handlers."""
        handlers = self._handlers.get(event)
        if not handlers:
            logger.debug("No handler registered for WS event: %s", event)
            await connection.send_event(
                event=CONNECTION_ERROR,
                data={"message": f"Unsupported event: {event}"},
                event_id=event_id,
            )
            return

        for handler in handlers:
            try:
                await handler(connection, data, event_id)
            except Exception as err:
                logger.exception("Error executing WS handler for event %s: %s", event, err)
                await connection.send_event(
                    event=CONNECTION_ERROR,
                    data={"message": "Failed to process request.", "original_event": event},
                    event_id=event_id,
                )


# Global WebSocketRouter singleton instance
ws_router = WebSocketRouter()
