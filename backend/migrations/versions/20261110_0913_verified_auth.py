"""Verified email authentication and Google identities.

Revision ID: 20261110_0913
Revises: 20261110_0912
"""
from alembic import op
import sqlalchemy as sa

revision = "20261110_0913"
down_revision = "20261110_0912"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=True)
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("google_subject", sa.String(255), nullable=True))
    op.create_unique_constraint("uq_users_google_subject", "users", ["google_subject"])
    op.create_table("auth_challenges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("purpose", sa.String(40), nullable=False),
        sa.Column("email", sa.String(255)),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("browser_digest", sa.String(64), nullable=False),
        sa.Column("code_digest", sa.String(64)),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)))
    op.create_index("ix_auth_challenges_expires_at", "auth_challenges", ["expires_at"])
    op.create_table("email_delivery_quotas",
        sa.Column("recipient_digest", sa.String(64), primary_key=True),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False))


def downgrade():
    # Google-only accounts must be migrated deliberately before removing auth.
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM users WHERE password_hash IS NULL")):
        raise RuntimeError("Cannot downgrade while Google-only accounts exist.")
    op.drop_table("email_delivery_quotas")
    op.drop_table("auth_challenges")
    op.drop_constraint("uq_users_google_subject", "users", type_="unique")
    op.drop_column("users", "google_subject")
    op.drop_column("users", "email_verified_at")
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=False)
