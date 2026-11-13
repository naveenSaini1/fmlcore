"""Record approximate account activity for the admin console."""
from alembic import op
import sqlalchemy as sa

revision = "20261113_0921"
down_revision = "20261113_0920"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("last_active_at", sa.DateTime(timezone=True)))


def downgrade():
    op.drop_column("users", "last_active_at")
