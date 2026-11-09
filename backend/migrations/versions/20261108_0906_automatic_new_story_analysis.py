"""Remove the per-user analysis toggle; new stories are analyzed automatically."""

from alembic import op

revision = "20261108_0906"
down_revision = "20261108_0905"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("same_sky_profiles", "auto_analyze_new_entries")


def downgrade() -> None:
    import sqlalchemy as sa

    op.add_column(
        "same_sky_profiles",
        sa.Column("auto_analyze_new_entries", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
