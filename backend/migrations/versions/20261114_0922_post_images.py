"""Store additional photos on posts."""
from alembic import op
import sqlalchemy as sa

revision = "20261114_0922"
down_revision = "20261113_0921"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("posts", sa.Column("extra_image_files", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("posts", "extra_image_files")
