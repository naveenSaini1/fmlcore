"""Link inbox notifications to Same Sky matches."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261108_0909"
down_revision = "20261108_0908"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("same_sky_match_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_notifications_same_sky_match_id_same_sky_matches",
        "notifications",
        "same_sky_matches",
        ["same_sky_match_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_notifications_same_sky_match_id",
        "notifications",
        ["same_sky_match_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_same_sky_match_id", table_name="notifications")
    op.drop_constraint(
        "fk_notifications_same_sky_match_id_same_sky_matches",
        "notifications",
        type_="foreignkey",
    )
    op.drop_column("notifications", "same_sky_match_id")
