"""Link Same Sky consent records to existing FMLCore posts."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261107_0902"
down_revision = "20261106_0901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "same_sky_entries",
        sa.Column("source_post_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_same_sky_entries_source_post_id_posts",
        "same_sky_entries",
        "posts",
        ["source_post_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_same_sky_entries_source_post_id",
        "same_sky_entries",
        ["source_post_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_same_sky_entries_source_post_id", table_name="same_sky_entries")
    op.drop_constraint("fk_same_sky_entries_source_post_id_posts", "same_sky_entries", type_="foreignkey")
    op.drop_column("same_sky_entries", "source_post_id")
