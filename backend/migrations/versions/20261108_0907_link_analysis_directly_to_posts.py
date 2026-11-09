"""Attach Same Sky analysis and embeddings directly to normal posts."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import VECTOR

revision = "20261108_0907"
down_revision = "20261108_0906"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "same_sky_analysis_new",
        sa.Column("post_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("entry_type", sa.String(20), nullable=False),
        sa.Column("analysis_fingerprint", sa.String(64), nullable=False),
        sa.Column("processing_status", sa.String(24), server_default="pending", nullable=False),
        sa.Column("duplicate_status", sa.String(24), server_default="clear", nullable=False),
        sa.Column("processing_error", sa.String(240), nullable=True),
        sa.Column("themes", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
        sa.Column("experience_context", sa.String(80), server_default="", nullable=False),
        sa.Column("safe_summary", sa.String(280), server_default="", nullable=False),
        sa.Column("emotional_context", sa.String(80), server_default="", nullable=False),
        sa.Column("copy_signal", sa.String(16), server_default="low", nullable=False),
        sa.Column("safety_flags", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
        sa.Column("model_name", sa.String(120), server_default="", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("entry_type IN ('experience', 'confession')", name="ck_same_sky_analysis_type"),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE", name="fk_same_sky_analysis_post_id_posts"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name="fk_same_sky_analysis_user_id_users"),
        sa.PrimaryKeyConstraint("post_id", name="pk_same_sky_analysis_new"),
    )
    op.create_table(
        "same_sky_embeddings_new",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("embedding", VECTOR(768), nullable=False),
        sa.Column("embedding_model", sa.String(120), nullable=False),
        sa.Column("embedding_version", sa.String(120), nullable=False),
        sa.Column("content_fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE", name="fk_same_sky_embeddings_post_id_posts"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name="fk_same_sky_embeddings_user_id_users"),
        sa.PrimaryKeyConstraint("id", name="pk_same_sky_embeddings_new"),
    )

    op.execute(sa.text("""
        INSERT INTO same_sky_analysis_new (
            post_id, user_id, entry_type, analysis_fingerprint, processing_status,
            duplicate_status, processing_error, themes, experience_context, safe_summary,
            emotional_context, copy_signal, safety_flags, model_name, created_at, updated_at
        )
        SELECT
            e.source_post_id,
            e.user_id,
            e.entry_type,
            e.analysis_fingerprint,
            CASE
                WHEN a.entry_id IS NULL AND e.processing_status = 'processing' THEN 'pending'
                WHEN a.entry_id IS NULL AND e.processing_status = 'ready' THEN 'reindex_required'
                ELSE e.processing_status
            END,
            e.duplicate_status,
            e.processing_error,
            COALESCE(a.themes, '[]'::json),
            COALESCE(a.experience_context, ''),
            COALESCE(a.safe_summary, ''),
            COALESCE(a.emotional_context, ''),
            COALESCE(a.copy_signal, 'low'),
            COALESCE(a.safety_flags, '[]'::json),
            COALESCE(a.model_name, ''),
            COALESCE(a.created_at, e.created_at),
            e.updated_at
        FROM same_sky_entries AS e
        LEFT JOIN same_sky_analysis AS a ON a.entry_id = e.id
        WHERE e.source_post_id IS NOT NULL AND e.matching_consent IS TRUE
    """))
    op.execute(sa.text("""
        INSERT INTO same_sky_embeddings_new (
            id, post_id, user_id, embedding, embedding_model,
            embedding_version, content_fingerprint, created_at
        )
        SELECT b.id, e.source_post_id, b.user_id, b.embedding, b.embedding_model,
               b.embedding_version, b.content_fingerprint, b.created_at
        FROM same_sky_embeddings AS b
        JOIN same_sky_entries AS e ON e.id = b.entry_id
        WHERE e.source_post_id IS NOT NULL AND e.matching_consent IS TRUE
    """))

    op.execute(sa.text("""
        UPDATE same_sky_jobs AS j
        SET job_type = 'analyze_post',
            payload = ((j.payload::jsonb - 'entry_id') ||
                       jsonb_build_object('post_id', e.source_post_id::text))::json
        FROM same_sky_entries AS e
        WHERE j.job_type = 'analyze_entry'
          AND j.payload::jsonb ->> 'entry_id' = e.id::text
          AND e.source_post_id IS NOT NULL
          AND e.matching_consent IS TRUE
    """))
    op.execute(sa.text("""
        DELETE FROM same_sky_jobs AS j
        WHERE j.job_type = 'analyze_entry'
          AND NOT EXISTS (
              SELECT 1 FROM same_sky_entries AS e
              WHERE j.payload::jsonb ->> 'entry_id' = e.id::text
                AND e.source_post_id IS NOT NULL
                AND e.matching_consent IS TRUE
          )
    """))

    op.drop_table("same_sky_embeddings")
    op.drop_table("same_sky_analysis")
    op.drop_table("same_sky_entries")
    op.rename_table("same_sky_analysis_new", "same_sky_analysis")
    op.rename_table("same_sky_embeddings_new", "same_sky_embeddings")
    op.create_index("ix_same_sky_analysis_user_type", "same_sky_analysis", ["user_id", "entry_type"])
    op.create_index("ix_same_sky_analysis_user_status", "same_sky_analysis", ["user_id", "processing_status"])
    op.create_index("ix_same_sky_analysis_user_id", "same_sky_analysis", ["user_id"])
    op.create_index("ix_same_sky_analysis_analysis_fingerprint", "same_sky_analysis", ["analysis_fingerprint"])
    op.create_index("ix_same_sky_analysis_processing_status", "same_sky_analysis", ["processing_status"])
    op.create_index("ix_same_sky_embeddings_post_id", "same_sky_embeddings", ["post_id"], unique=True)
    op.create_index("ix_same_sky_embeddings_user_id", "same_sky_embeddings", ["user_id"])
    op.create_index(
        "ix_same_sky_embeddings_hnsw",
        "same_sky_embeddings",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    raise RuntimeError(
        "This migration removes the duplicate Same Sky entry layer. Restore from a database backup to downgrade."
    )
