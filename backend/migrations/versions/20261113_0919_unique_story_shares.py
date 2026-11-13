"""Count each signed-in account once per story."""
from alembic import op
import sqlalchemy as sa

revision = "20261113_0919"
down_revision = "20261113_0918"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "story_shares",
        sa.Column("post_id", sa.Uuid(), sa.ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    )
    # Old totals do not identify the accounts that contributed to them.
    op.execute("UPDATE posts SET share_count = 0 WHERE share_count <> 0")


def downgrade():
    op.drop_table("story_shares")
