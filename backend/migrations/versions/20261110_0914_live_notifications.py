"""Publish committed notification changes for live inbox updates.

Revision ID: 20261110_0914
Revises: 20261110_0913
"""
from alembic import op

revision = "20261110_0914"
down_revision = "20261110_0913"
branch_labels = None
depends_on = None


def upgrade():
    # PostgreSQL delivers NOTIFY only after commit and coalesces identical
    # payloads within a transaction (for example, marking the whole inbox read).
    op.execute("""
        CREATE FUNCTION notify_inbox_changed() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                PERFORM pg_notify('fmlcore_notifications', OLD.recipient_id::text);
                RETURN OLD;
            END IF;
            PERFORM pg_notify('fmlcore_notifications', NEW.recipient_id::text);
            IF TG_OP = 'UPDATE' AND OLD.recipient_id <> NEW.recipient_id THEN
                PERFORM pg_notify('fmlcore_notifications', OLD.recipient_id::text);
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER notifications_changed
        AFTER INSERT OR UPDATE OR DELETE ON notifications
        FOR EACH ROW EXECUTE FUNCTION notify_inbox_changed();
    """)


def downgrade():
    op.execute("DROP TRIGGER notifications_changed ON notifications")
    op.execute("DROP FUNCTION notify_inbox_changed()")
