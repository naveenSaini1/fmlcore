"""Bootstrap the existing schema and add Same Sky Stage 9-1 tables."""

from alembic import op

from app.db import Base
import app.models  # noqa: F401 — register model metadata before create_all

revision = "20261106_0901"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pgvector must exist before SQLAlchemy creates the fixed-dimension vector column.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    # The app predates migrations. This idempotent first migration bootstraps missing
    # legacy tables, then adds same-sky tables without recreating existing user data.
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)
    # Preserve the compatibility upgrades previously performed during API startup.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_color VARCHAR(20) NOT NULL DEFAULT 'lime'")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_sticker VARCHAR(20) NOT NULL DEFAULT 'star'")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(30) NOT NULL DEFAULT 'system'")
    op.execute("ALTER TABLE posts ADD COLUMN IF NOT EXISTS surface VARCHAR(20) NOT NULL DEFAULT 'feed'")
    op.execute("ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'public'")
    op.execute("ALTER TABLE posts ADD COLUMN IF NOT EXISTS balloon_color VARCHAR(20)")
    op.execute("ALTER TABLE posts ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.drop_table("same_sky_jobs")
    op.drop_table("same_sky_matching_attempts")
    op.drop_table("same_sky_matches")
    op.drop_table("same_sky_embeddings")
    op.drop_table("same_sky_analysis")
    op.drop_table("same_sky_entries")
    op.drop_table("same_sky_profiles")
