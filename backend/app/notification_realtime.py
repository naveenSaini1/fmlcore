"""Bridge committed PostgreSQL inbox changes to each API process's sockets."""
import asyncio
from contextlib import suppress
import logging
from uuid import UUID

import psycopg
from sqlalchemy.engine import make_url

from app.chat.realtime import push_chat_unread
from app.config import settings
from app.leaderboard_live import publish_leaderboard_change
from app.browser_push import delivery_loop, ready as push_configured
from app.websocket.events import NOTIFICATION_CHANGED
from app.websocket.manager import ws_manager

logger = logging.getLogger(__name__)


async def recover_live_counts() -> None:
    publish_leaderboard_change()
    await ws_manager.broadcast(NOTIFICATION_CHANGED)
    for user_id in ws_manager.online_user_ids():
        await push_chat_unread(user_id)


async def listen_for_notifications(ready: asyncio.Event, push_wake: asyncio.Event | None = None) -> None:
    url = make_url(settings.database_url).set(drivername="postgresql")
    while True:
        try:
            async with await psycopg.AsyncConnection.connect(
                url.render_as_string(hide_password=False), autocommit=True,
                connect_timeout=10, keepalives=1, keepalives_idle=30,
                keepalives_interval=10, keepalives_count=3,
            ) as connection:
                await connection.execute("LISTEN fmlcore_notifications")
                await connection.execute("LISTEN fmlcore_chat_unread")
                await connection.execute("LISTEN fmlcore_leaderboard")
                await connection.execute("LISTEN fmlcore_browser_push")
                ready.set()
                # Catch up connected clients after a database-listener outage.
                # Schedule this so the notification generator starts immediately.
                recovery = asyncio.create_task(recover_live_counts())
                try:
                    async for notification in connection.notifies():
                        if notification.channel == "fmlcore_browser_push":
                            if push_wake is not None:
                                push_wake.set()
                            continue
                        if notification.channel == "fmlcore_leaderboard":
                            publish_leaderboard_change()
                            continue
                        try:
                            recipient_id = UUID(notification.payload)
                        except ValueError:
                            logger.warning("Ignored malformed inbox event")
                            continue
                        # No content or actor identity travels on this channel.
                        # The recipient re-fetches through the existing privacy filters.
                        if notification.channel == "fmlcore_chat_unread":
                            await push_chat_unread(recipient_id)
                        else:
                            await ws_manager.send_to_user(recipient_id, NOTIFICATION_CHANGED)
                finally:
                    recovery.cancel()
                    with suppress(asyncio.CancelledError):
                        await recovery
        except (psycopg.Error, OSError):
            logger.warning("Live inbox listener disconnected; retrying in 2 seconds", exc_info=True)
            await asyncio.sleep(2)


async def start_notification_listener(app) -> None:
    ready = asyncio.Event()
    push_wake = asyncio.Event()
    task = asyncio.create_task(listen_for_notifications(ready, push_wake))
    app.state.notification_listener = task
    try:
        await asyncio.wait_for(ready.wait(), timeout=15)
    except BaseException:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        raise
    app.state.push_delivery = asyncio.create_task(delivery_loop(push_wake)) if push_configured() else None


async def stop_notification_listener(app) -> None:
    if app.state.push_delivery:
        app.state.push_delivery.cancel()
        with suppress(asyncio.CancelledError):
            await app.state.push_delivery
    task = app.state.notification_listener
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
