"""Use Acid Lime as the default account theme."""

from alembic import op
import sqlalchemy as sa

revision = "20261108_0908"
down_revision = "20261108_0907"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "users",
        "theme",
        existing_type=sa.String(length=30),
        server_default="acid-lime",
    )


def downgrade() -> None:
    op.alter_column(
        "users",
        "theme",
        existing_type=sa.String(length=30),
        server_default="system",
    )
