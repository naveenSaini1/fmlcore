"""Add explicit consent for analyzing future posts automatically."""

from alembic import op
import sqlalchemy as sa

revision = "20261108_0905"
down_revision = "20261108_0904"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "same_sky_profiles",
        sa.Column("auto_analyze_new_entries", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("same_sky_profiles", "auto_analyze_new_entries")
