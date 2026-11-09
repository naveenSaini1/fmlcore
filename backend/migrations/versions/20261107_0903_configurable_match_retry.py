"""Allow configurable retries after a completed no-match search."""

from alembic import op

revision = "20261107_0903"
down_revision = "20261107_0902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_same_sky_attempt_user_day",
        "same_sky_matching_attempts",
        type_="unique",
    )


def downgrade() -> None:
    op.create_unique_constraint(
        "uq_same_sky_attempt_user_day",
        "same_sky_matching_attempts",
        ["user_id", "local_day"],
    )
