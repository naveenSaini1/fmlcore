import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.chat.schemas import (
    ChatConversationDetailOut,
    ChatConversationSummaryOut,
    ChatMessageListOut,
    ChatUnreadCountOut,
    SendMessageIn,
    WSTicketOut,
)
from app.chat.service import (
    get_conversation_detail,
    get_conversation_messages,
    get_total_unread_count,
    get_user_conversations,
    mark_conversation_read,
    send_message,
)
from app.db import get_db
from app.limiter import limit
from app.models import User
from app.security import read_user_id
from app.websocket.auth import create_ws_ticket
from app.websocket.events import CHAT_MESSAGE, CHAT_MESSAGE_DELIVERED, CHAT_MESSAGE_READ, CHAT_MESSAGE_SENT
from app.websocket.manager import ws_manager

router = APIRouter(prefix="/chat", tags=["Chat"])


def chat_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Authenticate the current user from HTTP-only session cookie."""
    user = db.get(User, read_user_id(request))
    if user is None:
        raise HTTPException(status_code=401, detail="Log in again.")
    return user


@router.get("/conversations", response_model=list[ChatConversationSummaryOut])
def list_conversations(
    db: Session = Depends(get_db),
    user: User = Depends(chat_user),
):
    """Retrieve all chat conversations for the current user, ordered by last activity."""
    return get_user_conversations(db=db, user_id=user.id)


@router.get("/conversations/{conversation_id}", response_model=ChatConversationDetailOut)
def get_conversation(
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(chat_user),
):
    """Get conversation details, ensuring user is a participant."""
    return get_conversation_detail(db=db, conversation_id=conversation_id, user_id=user.id)


@router.get("/conversations/{conversation_id}/messages", response_model=ChatMessageListOut)
def list_messages(
    conversation_id: uuid.UUID,
    cursor: str | None = Query(None, description="Cursor for pagination (created_at|id)"),
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(chat_user),
):
    """Retrieve cursor-paginated messages for a conversation in chronological order."""
    return get_conversation_messages(
        db=db,
        conversation_id=conversation_id,
        user_id=user.id,
        cursor=cursor,
        limit=limit,
    )


@router.post("/conversations/{conversation_id}/messages")
async def send_message_rest(
    conversation_id: uuid.UUID,
    body: SendMessageIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(chat_user),
):
    """REST fallback for sending a message."""
    limit(request, "chat_send", max_hits=60, window_seconds=60)
    msg, recipient_id = send_message(
        db=db,
        conversation_id=conversation_id,
        sender_id=user.id,
        content=body.content,
    )

    # Deliver via WebSocket to recipient if online
    msg_payload = {
        "id": str(msg.id),
        "conversation_id": str(msg.conversation_id),
        "sender_id": str(msg.sender_id),
        "sender_username": user.username,
        "content": msg.content,
        "message_type": msg.message_type,
        "created_at": msg.created_at.isoformat(),
        "status": "delivered" if ws_manager.is_user_online(recipient_id) else "sent",
    }
    await ws_manager.send_to_user(
        user_id=recipient_id,
        event=CHAT_MESSAGE,
        data={"conversation_id": str(conversation_id), "message": msg_payload},
    )

    return msg_payload


@router.post("/conversations/{conversation_id}/read")
async def mark_read(
    conversation_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(chat_user),
):
    """Mark all unread messages in conversation as read and notify the other participant."""
    limit(request, "chat_read", max_hits=120, window_seconds=60)
    count, other_id, read_at = mark_conversation_read(
        db=db,
        conversation_id=conversation_id,
        user_id=user.id,
    )

    # Broadcast read receipt to other participant
    if other_id and count > 0:
        await ws_manager.send_to_user(
            user_id=other_id,
            event=CHAT_MESSAGE_READ,
            data={
                "conversation_id": str(conversation_id),
                "read_by_user_id": str(user.id),
                "read_at": read_at.isoformat(),
                "count": count,
            },
        )

    return {"ok": True, "count": count}


@router.get("/unread-count", response_model=ChatUnreadCountOut)
def get_unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(chat_user),
):
    """Get the total count of unread chat messages for the current user."""
    return ChatUnreadCountOut(count=get_total_unread_count(db=db, user_id=user.id))


@router.get("/ws-ticket", response_model=WSTicketOut)
def get_websocket_ticket(
    request: Request,
    user: User = Depends(chat_user),
):
    """Issue a short-lived ticket token for WebSocket authentication."""
    ticket = create_ws_ticket(user_id=user.id, ttl_seconds=120)
    return WSTicketOut(ticket=ticket, expires_in=120)
