"""Committed leaderboard invalidations and opt-in browser push outbox."""
from alembic import op
import sqlalchemy as sa

revision = "20261111_0917"
down_revision = "20261111_0916"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('browser_push_subscriptions',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('endpoint', sa.Text(), nullable=False, unique=True),
        sa.Column('keys', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_browser_push_subscriptions_user_id', 'browser_push_subscriptions', ['user_id'])
    op.create_table('browser_push_deliveries',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('subscription_id', sa.Uuid(), sa.ForeignKey('browser_push_subscriptions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('notification_id', sa.Uuid(), sa.ForeignKey('notifications.id', ondelete='CASCADE')),
        sa.Column('message_id', sa.Uuid(), sa.ForeignKey('chat_messages.id', ondelete='CASCADE')),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('run_after', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('subscription_id', 'notification_id', name='uq_push_notification'),
        sa.UniqueConstraint('subscription_id', 'message_id', name='uq_push_message'))
    op.create_index('ix_browser_push_deliveries_subscription_id', 'browser_push_deliveries', ['subscription_id'])
    op.create_index('ix_browser_push_deliveries_run_after', 'browser_push_deliveries', ['run_after'])
    op.execute("""
        CREATE FUNCTION notify_leaderboard_changed() RETURNS trigger AS $$
        BEGIN
            PERFORM pg_notify('fmlcore_leaderboard', 'changed');
            RETURN NULL;
        END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER leaderboard_reactions_changed AFTER INSERT OR UPDATE OR DELETE ON reactions
        FOR EACH STATEMENT EXECUTE FUNCTION notify_leaderboard_changed();
        CREATE TRIGGER leaderboard_posts_changed AFTER DELETE OR UPDATE OF visibility, is_anonymous, body ON posts
        FOR EACH STATEMENT EXECUTE FUNCTION notify_leaderboard_changed();

        CREATE FUNCTION queue_browser_push() RETURNS trigger AS $$
        BEGIN
            IF TG_TABLE_NAME = 'notifications' THEN
                IF NOT NEW.is_read THEN
                    INSERT INTO browser_push_deliveries (id, subscription_id, notification_id)
                    SELECT gen_random_uuid(), id, NEW.id FROM browser_push_subscriptions
                    WHERE user_id = NEW.recipient_id;
                END IF;
            ELSE
                INSERT INTO browser_push_deliveries (id, subscription_id, message_id)
                SELECT gen_random_uuid(), s.id, NEW.id
                FROM browser_push_subscriptions s JOIN chat_participants p ON p.user_id = s.user_id
                WHERE p.conversation_id = NEW.conversation_id AND p.user_id <> NEW.sender_id AND NOT p.muted;
            END IF;
            PERFORM pg_notify('fmlcore_browser_push', 'queued');
            RETURN NEW;
        END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER browser_push_notification AFTER INSERT ON notifications
        FOR EACH ROW EXECUTE FUNCTION queue_browser_push();
        CREATE TRIGGER browser_push_message AFTER INSERT ON chat_messages
        FOR EACH ROW EXECUTE FUNCTION queue_browser_push();
    """)


def downgrade():
    op.execute('DROP TRIGGER browser_push_message ON chat_messages')
    op.execute('DROP TRIGGER browser_push_notification ON notifications')
    op.execute('DROP FUNCTION queue_browser_push()')
    op.execute('DROP TRIGGER leaderboard_posts_changed ON posts')
    op.execute('DROP TRIGGER leaderboard_reactions_changed ON reactions')
    op.execute('DROP FUNCTION notify_leaderboard_changed()')
    op.drop_table('browser_push_deliveries')
    op.drop_table('browser_push_subscriptions')
