"""Publish committed changes to chat unread counts.

Revision ID: 20261110_0915
Revises: 20261110_0914
"""
from alembic import op

revision = "20261110_0915"
down_revision = "20261110_0914"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE FUNCTION notify_chat_unread_changed() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF OLD.read_at IS NULL THEN
                    PERFORM pg_notify('fmlcore_chat_unread', OLD.user_id::text);
                END IF;
                RETURN OLD;
            END IF;
            IF TG_OP = 'INSERT' THEN
                IF NEW.read_at IS NULL THEN
                    PERFORM pg_notify('fmlcore_chat_unread', NEW.user_id::text);
                END IF;
            ELSIF OLD.read_at IS DISTINCT FROM NEW.read_at OR OLD.user_id <> NEW.user_id THEN
                PERFORM pg_notify('fmlcore_chat_unread', NEW.user_id::text);
                IF OLD.user_id <> NEW.user_id THEN
                    PERFORM pg_notify('fmlcore_chat_unread', OLD.user_id::text);
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER chat_unread_changed
        AFTER INSERT OR UPDATE OR DELETE ON chat_message_receipts
        FOR EACH ROW EXECUTE FUNCTION notify_chat_unread_changed();
    """)


def downgrade():
    op.execute("DROP TRIGGER chat_unread_changed ON chat_message_receipts")
    op.execute("DROP FUNCTION notify_chat_unread_changed()")
