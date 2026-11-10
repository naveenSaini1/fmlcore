import logging
import uuid
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, joinedload

from app.chat.models import (
    ChatConversation,
    ChatMessage,
    ChatMessageReceipt,
    ChatParticipant,
)
from app.chat.schemas import (
    ChatConversationDetailOut,
    ChatConversationSummaryOut,
    ChatMessageListOut,
    ChatMessageOut,
    ChatParticipantOut,
)
from app.models import SameSkyMatch, User, UserBlock
from app.safety import relationship_blocked
from app.websocket.manager import ws_manager

logger = logging.getLogger(__name__)


def user_to_participant_out(user: User, last_read_at: datetime | None = None) -> ChatParticipantOut:
    avatar = f"/media/avatars/{user.avatar_file}" if user.avatar_file else None
    return ChatParticipantOut(
        user_id=user.id,
        username=user.username,
        avatar_url=avatar,
        profile_color=user.profile_color or "lime",
        profile_sticker=user.profile_sticker or "star",
        bio=user.bio or "",
        is_online=ws_manager.is_user_online(user.id),
        last_read_at=last_read_at,
    )


def message_to_out(msg: ChatMessage, current_user_id: UUID) -> ChatMessageOut:
    # Determine delivery/read status from receipts or sender
    receipt = msg.receipts[0] if msg.receipts else None
    delivered_at = receipt.delivered_at if receipt else None
    read_at = receipt.read_at if receipt else None

    if read_at is not None:
        status = "read"
    elif delivered_at is not None:
        status = "delivered"
    else:
        status = "sent"

    return ChatMessageOut(
        id=msg.id,
        conversation_id=msg.conversation_id,
        sender_id=msg.sender_id,
        sender_username=msg.sender.username if msg.sender else "",
        content=msg.content,
        message_type=msg.message_type,
        created_at=msg.created_at,
        status=status,
        delivered_at=delivered_at,
        read_at=read_at,
    )


def get_or_create_same_sky_conversation(
    db: Session,
    match_id: UUID,
    user_a_id: UUID,
    user_b_id: UUID,
) -> ChatConversation:
    """Find existing or create a new conversation for a mutually accepted Same Sky match."""
    # Check if conversation already exists for this match
    conv = db.scalar(
        select(ChatConversation)
        .where(ChatConversation.same_sky_match_id == match_id)
        .with_for_update()
    )
    if conv is not None:
        return conv

    # Verify both users are not blocked
    if relationship_blocked(db, user_a_id, user_b_id):
        raise HTTPException(status_code=403, detail="Cannot create conversation with a blocked user.")

    now = datetime.now(timezone.utc)
    conv = ChatConversation(
        id=uuid.uuid4(),
        same_sky_match_id=match_id,
        conversation_type="same_sky",
        created_at=now,
        updated_at=now,
        last_message_at=now,
    )
    db.add(conv)
    db.flush()

    p_a = ChatParticipant(
        conversation_id=conv.id,
        user_id=user_a_id,
        joined_at=now,
        last_read_at=now,
    )
    p_b = ChatParticipant(
        conversation_id=conv.id,
        user_id=user_b_id,
        joined_at=now,
        last_read_at=now,
    )
    db.add(p_a)
    db.add(p_b)
    db.flush()
    return conv


def get_user_conversations(db: Session, user_id: UUID) -> list[ChatConversationSummaryOut]:
    """List all active conversations for a user, ordered by last_message_at desc."""
    # Find conversation IDs where user is participant
    my_parts = db.scalars(
        select(ChatParticipant)
        .where(ChatParticipant.user_id == user_id)
    ).all()
    if not my_parts:
        return []

    my_part_map = {p.conversation_id: p for p in my_parts}
    conv_ids = list(my_part_map.keys())

    # Load conversations with all participants and their user model
    conversations = db.scalars(
        select(ChatConversation)
        .options(
            joinedload(ChatConversation.participants).joinedload(ChatParticipant.user)
        )
        .where(ChatConversation.id.in_(conv_ids))
        .order_by(ChatConversation.last_message_at.desc(), ChatConversation.id.desc())
    ).unique().all()

    summaries: list[ChatConversationSummaryOut] = []

    for conv in conversations:
        # Find the other participant
        other_part = next((p for p in conv.participants if p.user_id != user_id), None)
        if not other_part or not other_part.user:
            continue

        my_part = my_part_map.get(conv.id)
        last_read_at = my_part.last_read_at if my_part else datetime.min.replace(tzinfo=timezone.utc)

        # Count unread messages (sent by other user after my last_read_at)
        unread_count = db.scalar(
            select(func.count(ChatMessage.id))
            .where(
                ChatMessage.conversation_id == conv.id,
                ChatMessage.sender_id != user_id,
                ChatMessage.created_at > last_read_at,
                ChatMessage.deleted_at.is_(None),
            )
        ) or 0

        # Fetch latest message
        latest_msg = db.scalar(
            select(ChatMessage)
            .options(
                joinedload(ChatMessage.sender),
                joinedload(ChatMessage.receipts),
            )
            .where(
                ChatMessage.conversation_id == conv.id,
                ChatMessage.deleted_at.is_(None),
            )
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(1)
        )

        last_message_out = message_to_out(latest_msg, user_id) if latest_msg else None

        summaries.append(
            ChatConversationSummaryOut(
                id=conv.id,
                same_sky_match_id=conv.same_sky_match_id,
                conversation_type=conv.conversation_type,
                other_user=user_to_participant_out(other_part.user, other_part.last_read_at),
                last_message=last_message_out,
                unread_count=unread_count,
                last_message_at=conv.last_message_at,
                created_at=conv.created_at,
            )
        )

    return summaries


def get_conversation_detail(db: Session, conversation_id: UUID, user_id: UUID) -> ChatConversationDetailOut:
    """Get full details of a single conversation, verifying user is a participant."""
    conv = db.scalar(
        select(ChatConversation)
        .options(
            joinedload(ChatConversation.participants).joinedload(ChatParticipant.user)
        )
        .where(ChatConversation.id == conversation_id)
    )
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    is_participant = any(p.user_id == user_id for p in conv.participants)
    if not is_participant:
        raise HTTPException(status_code=403, detail="You do not have access to this conversation.")

    other_part = next((p for p in conv.participants if p.user_id != user_id), None)
    if not other_part or not other_part.user:
        raise HTTPException(status_code=404, detail="Other participant not found.")

    return ChatConversationDetailOut(
        id=conv.id,
        same_sky_match_id=conv.same_sky_match_id,
        conversation_type=conv.conversation_type,
        participants=[user_to_participant_out(p.user, p.last_read_at) for p in conv.participants if p.user],
        other_user=user_to_participant_out(other_part.user, other_part.last_read_at),
        created_at=conv.created_at,
        last_message_at=conv.last_message_at,
    )


def get_conversation_messages(
    db: Session,
    conversation_id: UUID,
    user_id: UUID,
    cursor: str | None = None,
    limit: int = 30,
) -> ChatMessageListOut:
    """Retrieve paginated messages for a conversation."""
    # Check participant
    part = db.scalar(
        select(ChatParticipant.id)
        .where(
            ChatParticipant.conversation_id == conversation_id,
            ChatParticipant.user_id == user_id,
        )
    )
    if not part:
        raise HTTPException(status_code=403, detail="You do not have access to this conversation.")

    size = max(1, min(limit, 100))
    stmt = (
        select(ChatMessage)
        .options(
            joinedload(ChatMessage.sender),
            joinedload(ChatMessage.receipts),
        )
        .where(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.deleted_at.is_(None),
        )
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(size + 1)
    )

    if cursor:
        try:
            before_val, sep, before_id = cursor.partition("|")
            before_dt = datetime.fromisoformat(before_val)
            cursor_id = UUID(before_id) if sep else None
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid cursor.")

        if cursor_id:
            stmt = stmt.where(
                (ChatMessage.created_at < before_dt)
                | ((ChatMessage.created_at == before_dt) & (ChatMessage.id < cursor_id))
            )
        else:
            stmt = stmt.where(ChatMessage.created_at < before_dt)

    rows = db.scalars(stmt).unique().all()
    has_more = len(rows) > size
    rows = rows[:size]

    # Reverse to return in chronological order (oldest to newest in page)
    rows_chronological = list(reversed(rows))

    next_cursor = (
        f"{rows[-1].created_at.isoformat()}|{rows[-1].id}"
        if has_more and rows
        else None
    )

    return ChatMessageListOut(
        messages=[message_to_out(m, user_id) for m in rows_chronological],
        next_cursor=next_cursor,
        has_more=has_more,
    )


def send_message(
    db: Session,
    conversation_id: UUID,
    sender_id: UUID,
    content: str,
) -> tuple[ChatMessage, UUID]:
    """Persist a new chat message in PostgreSQL and create receipt for recipient."""
    text = content.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Message cannot be empty.")
    if len(text) > 2000:
        raise HTTPException(status_code=422, detail="Message exceeds maximum length of 2000 characters.")

    # Validate sender is a participant
    participants = db.scalars(
        select(ChatParticipant)
        .where(ChatParticipant.conversation_id == conversation_id)
    ).all()

    sender_part = next((p for p in participants if p.user_id == sender_id), None)
    if not sender_part:
        raise HTTPException(status_code=403, detail="You are not a participant in this conversation.")

    other_part = next((p for p in participants if p.user_id != sender_id), None)
    if not other_part:
        raise HTTPException(status_code=404, detail="Conversation recipient not found.")

    recipient_id = other_part.user_id

    # Check blocking
    if relationship_blocked(db, sender_id, recipient_id):
        raise HTTPException(status_code=403, detail="Cannot send message to this user.")

    now = datetime.now(timezone.utc)
    msg = ChatMessage(
        id=uuid.uuid4(),
        conversation_id=conversation_id,
        sender_id=sender_id,
        content=text,
        message_type="text",
        created_at=now,
        updated_at=now,
    )
    db.add(msg)
    db.flush()

    # Update conversation last_message_at
    conv = db.get(ChatConversation, conversation_id)
    if conv:
        conv.last_message_at = now
        conv.updated_at = now

    # Sender has read their own message
    sender_part.last_read_at = now

    # Create delivery receipt for recipient
    is_recipient_online = ws_manager.is_user_online(recipient_id)
    receipt = ChatMessageReceipt(
        id=uuid.uuid4(),
        message_id=msg.id,
        user_id=recipient_id,
        delivered_at=now if is_recipient_online else None,
        read_at=None,
    )
    db.add(receipt)
    db.commit()

    # Refresh with joined relationships
    db.refresh(msg)
    return msg, recipient_id


def mark_conversation_read(
    db: Session,
    conversation_id: UUID,
    user_id: UUID,
) -> tuple[int, UUID | None, datetime]:
    """Mark all unread messages in conversation as read for user.

    Returns (count_marked, other_participant_id, read_timestamp).
    """
    participants = db.scalars(
        select(ChatParticipant)
        .where(ChatParticipant.conversation_id == conversation_id)
    ).all()

    my_part = next((p for p in participants if p.user_id == user_id), None)
    if not my_part:
        raise HTTPException(status_code=403, detail="You are not a participant in this conversation.")

    other_part = next((p for p in participants if p.user_id != user_id), None)
    other_id = other_part.user_id if other_part else None

    now = datetime.now(timezone.utc)
    my_part.last_read_at = now

    # Update unread receipts for messages sent by the other participant
    result = db.execute(
        update(ChatMessageReceipt)
        .where(
            ChatMessageReceipt.user_id == user_id,
            ChatMessageReceipt.read_at.is_(None),
            ChatMessageReceipt.message_id.in_(
                select(ChatMessage.id).where(
                    ChatMessage.conversation_id == conversation_id,
                    ChatMessage.sender_id != user_id,
                )
            ),
        )
        .values(
            read_at=now,
            delivered_at=func.coalesce(ChatMessageReceipt.delivered_at, now),
        )
    )
    count = result.rowcount or 0
    db.commit()
    return count, other_id, now


def get_total_unread_count(db: Session, user_id: UUID) -> int:
    """Return total number of unread messages for user across all conversations."""
    count = db.scalar(
        select(func.count(ChatMessageReceipt.id))
        .where(
            ChatMessageReceipt.user_id == user_id,
            ChatMessageReceipt.read_at.is_(None),
        )
    )
    return count or 0
