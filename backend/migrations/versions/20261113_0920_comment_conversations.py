"""Preserve comment conversations and assign anonymous identities per post."""
from alembic import op
import sqlalchemy as sa

revision = "20261113_0920"
down_revision = "20261113_0919"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("comments", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.create_table(
        "comment_anonymous_identities",
        sa.Column("post_id", sa.Uuid(), sa.ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.UniqueConstraint("post_id", "number"),
    )
    op.execute("""
        INSERT INTO comment_anonymous_identities (post_id, user_id, number)
        SELECT post_id, author_id, row_number() OVER (
            PARTITION BY post_id ORDER BY min(created_at), author_id
        )
        FROM comments
        WHERE is_anonymous
        GROUP BY post_id, author_id
    """)


def downgrade():
    op.drop_table("comment_anonymous_identities")
    op.drop_column("comments", "deleted_at")
