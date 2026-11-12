import logging
from typing import Any
from uuid import UUID

from app.chat.service import mark_conversation_read, send_message, message_to_out
from app.db import SessionLocal
from app.chat.identity import participant_identity
from app.models import ChatParticipant
from app.websocket.connection import WebSocketConnection
from app.websocket.events import (
    CHAT_MESSAGE,
    CHAT_MESSAGE_DELIVERED,
    CHAT_MESSAGE_READ,
    CHAT_MESSAGE_SEND,
    CHAT_MESSAGE_SENT,
    CHAT_TYPING_START,
    CHAT_TYPING_STOP,
    CONNECTION_ERROR,
)
from app.websocket.manager import ws_manager
from app.websocket.router import ws_router

logger = logging.getLogger(__name__)


@ws_router.on(CHAT_MESSAGE_SEND)
async def handle_chat_message_send(
    connection: WebSocketConnection,
    data: dict[str, Any],
    event_id: str,
) -> None:
    """Handle incoming message from a client."""
    conv_id_raw = data.get("conversation_id")
    content = data.get("content")

    if not conv_id_raw or not content:
        await connection.send_event(
            event=CONNECTION_ERROR,
            data={"message": "Missing conversation_id or content.", "event": CHAT_MESSAGE_SEND},
            event_id=event_id,
        )
        return

    try:
        conversation_id = UUID(str(conv_id_raw))
    except (ValueError, TypeError):
        await connection.send_event(
            event=CONNECTION_ERROR,
            data={"message": "Invalid conversation_id UUID.", "event": CHAT_MESSAGE_SEND},
            event_id=event_id,
        )
        return

    with SessionLocal() as db:
        try:
            msg, recipient_id = send_message(
                db=db,
                conversation_id=conversation_id,
                sender_id=connection.user_id,
                content=str(content),
            )
        except Exception as err:
            detail = getattr(err, "detail", "Failed to send message.")
            await connection.send_event(
                event=CONNECTION_ERROR,
                data={"message": str(detail), "conversation_id": str(conversation_id)},
                event_id=event_id,
            )
            return

        is_recipient_online = ws_manager.is_user_online(recipient_id)

        msg_payload = message_to_out(msg, connection.user_id, db).model_dump(mode="json")
        recipient_payload = message_to_out(msg, recipient_id, db).model_dump(mode="json")

    # 1. Send confirmation to sender
    await connection.send_event(
        event=CHAT_MESSAGE_SENT,
        data={
            "conversation_id": str(conversation_id),
            "message": msg_payload,
            "client_event_id": event_id,
        },
        event_id=event_id,
    )

    # 2. Deliver to recipient if online
    if is_recipient_online:
        await ws_manager.send_to_user(
            user_id=recipient_id,
            event=CHAT_MESSAGE,
            data={
                "conversation_id": str(conversation_id),
                "message": recipient_payload,
            },
        )
        # Notify sender of delivery
        await connection.send_event(
            event=CHAT_MESSAGE_DELIVERED,
            data={
                "conversation_id": str(conversation_id),
                "message_id": str(msg.id),
            },
        )


@ws_router.on(CHAT_TYPING_START)
async def handle_chat_typing_start(
    connection: WebSocketConnection,
    data: dict[str, Any],
    event_id: str,
) -> None:
    """Forward typing start event to the other participant."""
    conv_id_raw = data.get("conversation_id")
    if not conv_id_raw:
        return

    try:
        conv_id = UUID(str(conv_id_raw))
    except (ValueError, TypeError):
        return

    with SessionLocal() as db:
        participant_identity(db, conv_id, connection.user_id, connection.user_id)
        # Find other participant
        other_part = db.query(ChatParticipant).filter(
            ChatParticipant.conversation_id == conv_id,
            ChatParticipant.user_id != connection.user_id,
        ).first()
        if not other_part:
            return

        recipient_id = other_part.user_id
        identity = participant_identity(db, conv_id, connection.user_id, recipient_id)
        sender_username = identity.username

    await ws_manager.send_to_user(
        user_id=recipient_id,
        event=CHAT_TYPING_START,
        data={
            "conversation_id": str(conv_id),
            "user_id": str(identity.user_id),
            "username": sender_username,
        },
    )


@ws_router.on(CHAT_TYPING_STOP)
async def handle_chat_typing_stop(
    connection: WebSocketConnection,
    data: dict[str, Any],
    event_id: str,
) -> None:
    """Forward typing stop event to the other participant."""
    conv_id_raw = data.get("conversation_id")
    if not conv_id_raw:
        return

    try:
        conv_id = UUID(str(conv_id_raw))
    except (ValueError, TypeError):
        return

    with SessionLocal() as db:
        other_part = db.query(ChatParticipant).filter(
            ChatParticipant.conversation_id == conv_id,
            ChatParticipant.user_id != connection.user_id,
        ).first()
        if not other_part:
            return
        recipient_id = other_part.user_id
        identity = participant_identity(db, conv_id, connection.user_id, recipient_id)

    await ws_manager.send_to_user(
        user_id=recipient_id,
        event=CHAT_TYPING_STOP,
        data={
            "conversation_id": str(conv_id),
            "user_id": str(identity.user_id),
        },
    )


@ws_router.on(CHAT_MESSAGE_READ)
async def handle_chat_message_read(
    connection: WebSocketConnection,
    data: dict[str, Any],
    event_id: str,
) -> None:
    """Handle mark-as-read via WebSocket."""
    conv_id_raw = data.get("conversation_id")
    if not conv_id_raw:
        return

    try:
        conv_id = UUID(str(conv_id_raw))
    except (ValueError, TypeError):
        return

    with SessionLocal() as db:
        count, other_id, read_at = mark_conversation_read(
            db=db,
            conversation_id=conv_id,
            user_id=connection.user_id,
        )

        reader_id = participant_identity(db, conv_id, connection.user_id, other_id).user_id if other_id else None

    if other_id and count > 0:
        await ws_manager.send_to_user(
            user_id=other_id,
            event=CHAT_MESSAGE_READ,
            data={
                "conversation_id": str(conv_id),
                "read_by_user_id": str(reader_id),
                "read_at": read_at.isoformat(),
                "count": count,
            },
        )
