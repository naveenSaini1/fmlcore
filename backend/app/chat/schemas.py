import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class ChatParticipantOut(BaseModel):
    alias: str = ""
    nickname: str | None = None
    is_revealed: bool = False
    profile_username: str | None = None
    user_id: uuid.UUID
    username: str
    avatar_url: str | None = None
    profile_color: str = "lime"
    profile_sticker: str = "star"
    bio: str = ""
    is_online: bool = False
    last_read_at: datetime | None = None


class ChatMessageOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    sender_id: uuid.UUID
    sender_username: str
    content: str
    message_type: str = "text"
    created_at: datetime
    status: str = "sent"  # "sent", "delivered", "read"
    delivered_at: datetime | None = None
    read_at: datetime | None = None


class ChatConversationSummaryOut(BaseModel):
    id: uuid.UUID
    same_sky_match_id: uuid.UUID | None = None
    conversation_type: str = "same_sky"
    other_user: ChatParticipantOut
    last_message: ChatMessageOut | None = None
    unread_count: int = 0
    last_message_at: datetime
    created_at: datetime


class ChatIdentityIn(BaseModel):
    nickname: str | None = Field(default=None, max_length=40)
    profile_revealed: bool | None = None


class ChatConversationDetailOut(BaseModel):
    my_profile_revealed: bool = False
    id: uuid.UUID
    same_sky_match_id: uuid.UUID | None = None
    conversation_type: str = "same_sky"
    participants: list[ChatParticipantOut]
    other_user: ChatParticipantOut
    created_at: datetime
    last_message_at: datetime


class ChatMessageListOut(BaseModel):
    messages: list[ChatMessageOut]
    next_cursor: str | None = None
    has_more: bool = False


class SendMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class WSTicketOut(BaseModel):
    ticket: str
    expires_in: int = 120


class ChatUnreadCountOut(BaseModel):
    count: int
