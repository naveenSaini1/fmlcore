"""Track who declined a Same Sky connection."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261108_0910"
down_revision = "20261108_0909"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "same_sky_matches",
        sa.Column("declined_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_same_sky_matches_declined_by_id_users",
        "same_sky_matches",
        "users",
        ["declined_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_same_sky_matches_declined_by_id", "same_sky_matches", ["declined_by_id"])
    op.execute(sa.text("""
        UPDATE same_sky_matches
        SET declined_by_id = CASE
            WHEN accepted_by_a THEN user_b_id
            WHEN accepted_by_b THEN user_a_id
            ELSE NULL
        END
        WHERE status = 'declined'
    """))


def downgrade() -> None:
    op.drop_index("ix_same_sky_matches_declined_by_id", table_name="same_sky_matches")
    op.drop_constraint("fk_same_sky_matches_declined_by_id_users", "same_sky_matches", type_="foreignkey")
    op.drop_column("same_sky_matches", "declined_by_id")
