"""Add the persistent Skin Studio preference."""

from alembic import op
import sqlalchemy as sa


revision = "20261110_0912"
down_revision = "20261109_0911"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("skin", sa.String(length=30), server_default="calm", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "skin")
