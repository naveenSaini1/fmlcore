"""Real-time chat persistence models and relationships."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261109_0911"
down_revision = "20261108_0910"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. chat_conversations
    op.create_table(
        "chat_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("same_sky_match_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("conversation_type", sa.String(length=32), server_default="same_sky", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["same_sky_match_id"], ["same_sky_matches.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("same_sky_match_id", name="uq_chat_conversations_same_sky_match_id"),
    )
    op.create_index("ix_chat_conversations_same_sky_match_id", "chat_conversations", ["same_sky_match_id"])
    op.create_index("ix_chat_conversations_last_message_at", "chat_conversations", ["last_message_at"])

    # 2. chat_participants
    op.create_table(
        "chat_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_read_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("muted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_chat_participant_conv_user"),
    )
    op.create_index("ix_chat_participants_conversation_id", "chat_participants", ["conversation_id"])
    op.create_index("ix_chat_participants_user_id", "chat_participants", ["user_id"])
    op.create_index("ix_chat_participants_user_conv", "chat_participants", ["user_id", "conversation_id"])

    # 3. chat_messages
    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sender_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("message_type", sa.String(length=32), server_default="text", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_chat_messages_conversation_id", "chat_messages", ["conversation_id"])
    op.create_index("ix_chat_messages_sender_id", "chat_messages", ["sender_id"])
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"])
    op.create_index("ix_chat_messages_conv_created", "chat_messages", ["conversation_id", "created_at"])

    # 4. chat_message_receipts
    op.create_table(
        "chat_message_receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("message_id", "user_id", name="uq_chat_receipt_msg_user"),
    )
    op.create_index("ix_chat_message_receipts_message_id", "chat_message_receipts", ["message_id"])
    op.create_index("ix_chat_message_receipts_user_id", "chat_message_receipts", ["user_id"])
    op.create_index("ix_chat_receipts_user_read", "chat_message_receipts", ["user_id", "read_at"])


def downgrade() -> None:
    op.drop_table("chat_message_receipts")
    op.drop_table("chat_messages")
    op.drop_table("chat_participants")
    op.drop_table("chat_conversations")
