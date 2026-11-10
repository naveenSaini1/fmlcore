import abc
import asyncio
import logging
from collections import defaultdict
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)

CallbackType = Callable[[str, dict[str, Any]], Coroutine[Any, Any, None]]


class BaseBroadcaster(abc.ABC):
    """Abstract broadcaster interface for horizontal scaling readiness."""

    @abc.abstractmethod
    async def publish(self, channel: str, message: dict[str, Any]) -> None:
        """Publish an event payload to a channel."""
        pass

    @abc.abstractmethod
    async def subscribe(self, channel: str, callback: CallbackType) -> None:
        """Subscribe to events on a channel."""
        pass

    @abc.abstractmethod
    async def unsubscribe(self, channel: str, callback: CallbackType) -> None:
        """Unsubscribe from a channel."""
        pass


class InMemoryBroadcaster(BaseBroadcaster):
    """Local in-memory broadcaster suitable for single-instance or local development.

    Can be replaced or extended with RedisBroadcaster without altering business logic.
    """

    def __init__(self) -> None:
        self._subscribers: dict[str, set[CallbackType]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def publish(self, channel: str, message: dict[str, Any]) -> None:
        callbacks = list(self._subscribers.get(channel, set()))
        if not callbacks:
            return

        async def _safe_call(cb: CallbackType) -> None:
            try:
                await cb(channel, message)
            except Exception as err:
                logger.error("Error executing broadcaster subscriber on channel %s: %s", channel, err)

        await asyncio.gather(*[_safe_call(cb) for cb in callbacks], return_exceptions=True)

    async def subscribe(self, channel: str, callback: CallbackType) -> None:
        async with self._lock:
            self._subscribers[channel].add(callback)

    async def unsubscribe(self, channel: str, callback: CallbackType) -> None:
        async with self._lock:
            if channel in self._subscribers:
                self._subscribers[channel].discard(callback)
                if not self._subscribers[channel]:
                    del self._subscribers[channel]
