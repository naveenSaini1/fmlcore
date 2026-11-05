import re
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

USERNAME = re.compile(r"[A-Za-z0-9_]{3,20}")


class SignupIn(BaseModel):
    email: EmailStr
    username: str
    password: str
    age_confirmed: bool

    @field_validator("username")
    @classmethod
    def username_ok(cls, value: str) -> str:
        cleaned = value.strip()
        if not USERNAME.fullmatch(cleaned):
            raise ValueError("Use 3–20 letters, numbers, or underscores.")
        return cleaned

    @field_validator("password")
    @classmethod
    def password_ok(cls, value: str) -> str:
        if len(value) < 8 or len(value) > 72:
            raise ValueError("Use 8 to 72 characters.")
        return value

    @field_validator("age_confirmed")
    @classmethod
    def age_ok(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("FMLCore is for people 18 and over.")
        return value


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class ThemeIn(BaseModel):
    theme: str

    @field_validator("theme")
    @classmethod
    def theme_ok(cls, value: str) -> str:
        if value not in {"system", "acid-lime", "electric-purple", "chaos-coral", "midnight", "classic-paper"}:
            raise ValueError("Choose one of the available themes.")
        return value


class ProfileIn(BaseModel):
    username: str
    bio: str = ""
    profile_color: str | None = None
    profile_sticker: str | None = None

    @field_validator("username")
    @classmethod
    def username_ok(cls, value: str) -> str:
        cleaned = value.strip()
        if not USERNAME.fullmatch(cleaned):
            raise ValueError("Use 3–20 letters, numbers, or underscores.")
        return cleaned

    @field_validator("bio")
    @classmethod
    def bio_ok(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) > 160:
            raise ValueError("Keep the bio under 160 characters.")
        return cleaned

    @field_validator("profile_color")
    @classmethod
    def profile_color_ok(cls, value: str | None) -> str | None:
        if value is not None and value not in {"lime", "purple", "coral", "paper"}:
            raise ValueError("Pick one of the available profile colors.")
        return value

    @field_validator("profile_sticker")
    @classmethod
    def profile_sticker_ok(cls, value: str | None) -> str | None:
        if value is not None and value not in {"star", "heart", "ghost", "spark", "moon", "flower"}:
            raise ValueError("Pick one of the available profile stickers.")
        return value


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    bio: str
    profile_color: str
    profile_sticker: str
    theme: str
    avatar_url: str | None
    joined_at: datetime


class AuthorOut(BaseModel):
    id: uuid.UUID
    username: str
    avatar_url: str | None
    profile_color: str = "lime"
    profile_sticker: str = "star"


class PostOut(BaseModel):
    id: uuid.UUID
    body: str
    category: str
    mood: str
    image_url: str | None
    is_anonymous: bool
    surface: str = "feed"
    visibility: str = "public"
    balloon_color: str | None = None
    author: AuthorOut | None
    reactions: dict[str, int] = {}
    reaction_count: int = 0
    my_reaction: str | None = None
    comment_count: int = 0
    created_at: datetime


class FeedOut(BaseModel):
    posts: list[PostOut]
    next_cursor: str | None


class ReactionIn(BaseModel):
    type: str


class CommentIn(BaseModel):
    body: str
    parent_id: uuid.UUID | None = None
    is_anonymous: bool = False


class CommentOut(BaseModel):
    id: uuid.UUID
    body: str
    is_anonymous: bool
    author: AuthorOut | None
    parent_id: uuid.UUID | None
    created_at: datetime
    replies: list["CommentOut"] = []


class CommentsOut(BaseModel):
    comments: list[CommentOut]
    next_cursor: str | None


class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: str
    actor: AuthorOut | None
    is_anonymous: bool
    post_id: uuid.UUID | None
    comment_id: uuid.UUID | None
    is_read: bool
    created_at: datetime


class NotificationsOut(BaseModel):
    notifications: list[NotificationOut]
    next_cursor: str | None


class LeaderboardEntryOut(BaseModel):
    rank: int
    weekly_votes: int
    post: PostOut


class LeaderboardOut(BaseModel):
    entries: list[LeaderboardEntryOut]
    next_offset: int | None


class SafetyUserOut(BaseModel):
    id: uuid.UUID
    username: str


class SafetyUsersOut(BaseModel):
    users: list[SafetyUserOut]


class ReportIn(BaseModel):
    target_type: str
    target_id: uuid.UUID
    reason: str
    details: str = ""

    @field_validator("target_type")
    @classmethod
    def target_type_ok(cls, value: str) -> str:
        if value not in {"post", "comment", "user"}:
            raise ValueError("Choose a post, comment, or account to report.")
        return value

    @field_validator("reason")
    @classmethod
    def reason_ok(cls, value: str) -> str:
        if value not in {"harassment", "hate", "spam", "self_harm", "other"}:
            raise ValueError("Choose a report reason.")
        return value

    @field_validator("details")
    @classmethod
    def details_ok(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) > 500:
            raise ValueError("Keep report details under 500 characters.")
        return cleaned


CommentOut.model_rebuild()
