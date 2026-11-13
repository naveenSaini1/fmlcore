"""Store successful story share counts."""
from alembic import op
import sqlalchemy as sa

revision = "20261113_0918"
down_revision = "20261111_0917"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("posts", sa.Column("share_count", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    op.drop_column("posts", "share_count")
