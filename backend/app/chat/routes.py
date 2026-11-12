import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.chat.schemas import (
    ChatConversationDetailOut,
    ChatIdentityIn,
    ChatConversationSummaryOut,
    ChatMessageListOut,
    ChatUnreadCountOut,
    SendMessageIn,
    WSTicketOut,
)
from app.chat.service import (
    get_conversation_detail,
    message_to_out,
    get_conversation_messages,
    get_total_unread_count,
    get_user_conversations,
    mark_conversation_read,
    send_message,
)
from app.db import get_db
from app.limiter import limit
from app.models import User, ChatParticipant
from app.chat.identity import participant_identity
from app.safety import relationship_blocked
from sqlalchemy import select
from app.security import read_user_id
from app.websocket.auth import create_ws_ticket
from app.websocket.events import CHAT_IDENTITY_CHANGED, CHAT_MESSAGE, CHAT_MESSAGE_DELIVERED, CHAT_MESSAGE_READ, CHAT_MESSAGE_SENT
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
    msg_payload = message_to_out(msg, user.id, db).model_dump(mode="json")
    recipient_payload = message_to_out(msg, recipient_id, db).model_dump(mode="json")
    await ws_manager.send_to_user(
        user_id=recipient_id,
        event=CHAT_MESSAGE,
        data={"conversation_id": str(conversation_id), "message": recipient_payload},
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
                "read_by_user_id": str(participant_identity(db, conversation_id, user.id, other_id).user_id),
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


@router.patch("/conversations/{conversation_id}/identity", response_model=ChatConversationDetailOut)
async def update_identity(conversation_id: uuid.UUID, body: ChatIdentityIn,
    db: Session = Depends(get_db), user: User = Depends(chat_user)):
    get_conversation_detail(db, conversation_id, user.id)
    parts = db.scalars(select(ChatParticipant).where(ChatParticipant.conversation_id == conversation_id).order_by(ChatParticipant.user_id).with_for_update()).all()
    own = next(p for p in parts if p.user_id == user.id)
    other = next(p for p in parts if p.user_id != user.id)
    if relationship_blocked(db, user.id, other.user_id):
        raise HTTPException(403, "This connection is unavailable.")
    if "nickname" in body.model_fields_set:
        own.nickname = (body.nickname.strip() or None) if body.nickname else None
    if body.profile_revealed is not None:
        own.profile_revealed = body.profile_revealed
    db.commit()
    # No identity fields in the event: each viewer reloads their authorized view.
    await ws_manager.send_to_users([user.id, other.user_id], event=CHAT_IDENTITY_CHANGED, data={"conversation_id": str(conversation_id)})
    return get_conversation_detail(db, conversation_id, user.id)
