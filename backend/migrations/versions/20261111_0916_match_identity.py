"""Add per-conversation identity consent and private nicknames."""
from alembic import op
import sqlalchemy as sa
revision = "20261111_0916"
down_revision = "20261110_0915"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("chat_participants", sa.Column("profile_revealed", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("chat_participants", sa.Column("nickname", sa.String(40), nullable=True))

def downgrade():
    op.drop_column("chat_participants", "nickname")
    op.drop_column("chat_participants", "profile_revealed")
