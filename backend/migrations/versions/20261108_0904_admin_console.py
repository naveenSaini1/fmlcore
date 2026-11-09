"""Add admin login activity and runtime settings storage."""

from alembic import op
import sqlalchemy as sa

revision = "20261108_0904"
down_revision = "20261107_0903"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_last_login_at", "users", ["last_login_at"])
    # Signup immediately issues a session cookie, so existing accounts were signed in
    # when they were created. Preserve that known initial sign-in as the baseline.
    op.execute("UPDATE users SET last_login_at = created_at WHERE last_login_at IS NULL")
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(length=80), primary_key=True),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
    )


def downgrade() -> None:
    op.drop_table("system_settings")
    op.drop_index("ix_users_last_login_at", table_name="users")
    op.drop_column("users", "last_login_at")
