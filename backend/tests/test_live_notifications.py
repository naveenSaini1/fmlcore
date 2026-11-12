"""Committed database changes drive targeted inbox events, without polling.

Requires migrated PostgreSQL. All committed test records are removed afterward.
"""
import asyncio
from contextlib import suppress
import unittest
from unittest.mock import patch
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete

from app.db import SessionLocal
from app.models import Notification, User, ChatConversation, ChatMessage, ChatMessageReceipt
from app.notification_realtime import listen_for_notifications
from app.websocket.events import NOTIFICATION_CHANGED, CHAT_UNREAD_COUNT


class InboxBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.recipient = uuid.uuid4()
        self.actor = uuid.uuid4()
        with SessionLocal() as db:
            for user_id in (self.recipient, self.actor):
                name = 'live_' + user_id.hex[:12]
                db.add(User(id=user_id, email=name + '@example.com', username=name,
                            username_lower=name, password_hash='test-only'))
            db.commit()
        self.events = asyncio.Queue()

        async def send(user_id, event, data=None):
            await self.events.put((user_id, event) if data is None else (user_id, event, data))

        self.patch = patch('app.notification_realtime.ws_manager')
        self.manager = self.patch.start()
        self.manager.send_to_user.side_effect = send
        self.manager.online_user_ids.return_value = set()
        self.manager.is_user_online.return_value = True
        self.chat_patch = patch("app.chat.realtime.ws_manager", self.manager)
        self.chat_patch.start()
        self.conversation_id = None
        async def broadcast(event):
            return 0
        self.manager.broadcast.side_effect = broadcast
        ready = asyncio.Event()
        self.listener = asyncio.create_task(listen_for_notifications(ready))
        await asyncio.wait_for(ready.wait(), 5)

    async def asyncTearDown(self):
        self.listener.cancel()
        with suppress(asyncio.CancelledError):
            await self.listener
        self.chat_patch.stop()
        self.patch.stop()
        with SessionLocal() as db:
            if self.conversation_id:
                db.execute(delete(ChatConversation).where(ChatConversation.id == self.conversation_id))
            db.execute(delete(Notification).where(Notification.recipient_id.in_([self.recipient, self.actor])))
            db.execute(delete(User).where(User.id.in_([self.recipient, self.actor])))
            db.commit()

    def add_notification(self, db):
        row = Notification(recipient_id=self.recipient, actor_id=self.actor, kind='reaction')
        db.add(row)
        db.flush()
        return row.id

    async def expect_change(self):
        self.assertEqual(await asyncio.wait_for(self.events.get(), 3),
                         (self.recipient, NOTIFICATION_CHANGED))

    async def test_commit_read_and_delete_notify_only_recipient(self):
        with SessionLocal() as db:
            notification_id = self.add_notification(db)
            db.commit()
        await self.expect_change()
        with SessionLocal() as db:
            db.get(Notification, notification_id).is_read = True
            db.commit()
        await self.expect_change()
        with SessionLocal() as db:
            db.execute(delete(Notification).where(Notification.id == notification_id))
            db.commit()
        await self.expect_change()

    async def test_rollback_never_publishes(self):
        with SessionLocal() as db:
            self.add_notification(db)
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(self.events.get(), .15)
            db.rollback()
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(self.events.get(), .15)

    async def test_bulk_changes_coalesce_and_offline_changes_persist(self):
        with SessionLocal() as db:
            ids = [self.add_notification(db) for _ in range(3)]
            db.commit()
        await self.expect_change()
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(self.events.get(), .15)
        with SessionLocal() as db:
            self.assertTrue(all(db.get(Notification, key) is not None for key in ids))
            for key in ids:
                db.get(Notification, key).is_read = True
            db.commit()
        await self.expect_change()
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(self.events.get(), .15)

    async def test_chat_count_pushes_insert_read_delete_and_ignores_delivery(self):
        with SessionLocal() as db:
            conversation = ChatConversation()
            db.add(conversation); db.flush()
            self.conversation_id = conversation.id
            message = ChatMessage(conversation_id=conversation.id, sender_id=self.actor, content='test')
            db.add(message); db.flush()
            receipt = ChatMessageReceipt(message_id=message.id, user_id=self.recipient)
            db.add(receipt); db.flush()
            receipt_id = receipt.id
            db.commit()
        self.assertEqual(await asyncio.wait_for(self.events.get(), 3),
                         (self.recipient, CHAT_UNREAD_COUNT, {'count': 1}))
        with SessionLocal() as db:
            db.get(ChatMessageReceipt, receipt_id).delivered_at = datetime.now(timezone.utc)
            db.commit()
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(self.events.get(), .15)
        with SessionLocal() as db:
            db.get(ChatMessageReceipt, receipt_id).read_at = datetime.now(timezone.utc)
            db.commit()
        self.assertEqual(await asyncio.wait_for(self.events.get(), 3),
                         (self.recipient, CHAT_UNREAD_COUNT, {'count': 0}))
        with SessionLocal() as db:
            db.get(ChatMessageReceipt, receipt_id).read_at = None
            db.rollback()
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(self.events.get(), .15)
        with SessionLocal() as db:
            db.get(ChatMessageReceipt, receipt_id).read_at = None
            db.commit()
        self.assertEqual(await asyncio.wait_for(self.events.get(), 3),
                         (self.recipient, CHAT_UNREAD_COUNT, {'count': 1}))
        with SessionLocal() as db:
            db.execute(delete(ChatMessageReceipt).where(ChatMessageReceipt.id == receipt_id))
            db.commit()
        self.assertEqual(await asyncio.wait_for(self.events.get(), 3),
                         (self.recipient, CHAT_UNREAD_COUNT, {'count': 0}))


if __name__ == '__main__':
    unittest.main()
