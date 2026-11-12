"""Exercise committed rank changes and push delivery against migrated PostgreSQL."""
import asyncio
import uuid
import unittest
from contextlib import suppress

from sqlalchemy import delete, select

from app.browser_push import delivery_allowed, validate_endpoint
from app.db import SessionLocal
from app.leaderboard_live import _subscribers
from app.main import leaderboard
from app.models import BrowserPushDelivery, BrowserPushSubscription, Notification, Post, Reaction, User, UserBlock
from app.notification_realtime import listen_for_notifications


class LiveReleaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.author, self.voter = uuid.uuid4(), uuid.uuid4()
        with SessionLocal() as db:
            for user_id in (self.author, self.voter):
                name = "release_" + user_id.hex[:10]
                db.add(User(id=user_id, email=name + "@example.com", username=name, username_lower=name))
            db.flush()
            story = Post(author_id=self.author, body="Public test story", category="life", mood="sad")
            hidden = Post(author_id=self.author, body="Private test story", category="life", mood="sad", visibility="private")
            db.add_all([story, hidden])
            db.flush()
            self.story, self.hidden = story.id, hidden.id
            db.commit()

    async def asyncTearDown(self):
        with SessionLocal() as db:
            db.execute(delete(Notification).where(Notification.recipient_id == self.author))
            db.execute(delete(Reaction).where(Reaction.post_id.in_([self.story, self.hidden])))
            db.execute(delete(Post).where(Post.id.in_([self.story, self.hidden])))
            db.execute(delete(User).where(User.id.in_([self.author, self.voter])))
            db.commit()

    async def test_vote_commit_updates_public_ranking_and_private_stories_stay_out(self):
        ready = asyncio.Event()
        queue = asyncio.Queue(maxsize=1)
        task = asyncio.create_task(listen_for_notifications(ready))
        try:
            await asyncio.wait_for(ready.wait(), 5)
            await asyncio.sleep(0.05)
            _subscribers.add(queue)
            with SessionLocal() as db:
                db.add_all([Reaction(post_id=story_id, user_id=self.voter, type="relate") for story_id in (self.story, self.hidden)])
                db.flush()
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(queue.get(), 0.1)
                db.commit()
            await asyncio.wait_for(queue.get(), 3)
            with SessionLocal() as db:
                ids = [entry.post.id for entry in leaderboard(limit=20, db=db, user=None).entries]
                self.assertIn(self.story, ids)
                self.assertNotIn(self.hidden, ids)
                db.execute(delete(Reaction).where(Reaction.post_id == self.story))
                db.commit()
            await asyncio.wait_for(queue.get(), 3)
            with SessionLocal() as db:
                self.assertNotIn(self.story, [entry.post.id for entry in leaderboard(limit=20, db=db, user=None).entries])
        finally:
            _subscribers.discard(queue)
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    async def test_push_is_queued_only_for_opted_in_browser_and_checks_blocks(self):
        with SessionLocal() as db:
            subscription = BrowserPushSubscription(user_id=self.author, endpoint="https://fcm.googleapis.com/fcm/send/" + self.author.hex, keys={})
            db.add(subscription)
            db.flush()
            note = Notification(recipient_id=self.author, actor_id=self.voter, kind="reaction", post_id=self.story)
            db.add(note)
            db.flush()
            job = db.scalar(select(BrowserPushDelivery).where(BrowserPushDelivery.notification_id == note.id))
            self.assertEqual(job.subscription_id, subscription.id)
            self.assertTrue(delivery_allowed(db, job, subscription))
            db.add(UserBlock(blocker_id=self.author, blocked_id=self.voter))
            db.flush()
            self.assertFalse(delivery_allowed(db, job, subscription))
            db.delete(subscription)
            db.flush()
            self.assertIsNone(db.scalar(select(BrowserPushDelivery.id).where(BrowserPushDelivery.id == job.id)))
            db.rollback()

    async def test_push_endpoints_reject_untrusted_origins(self):
        for url in ["http://fcm.googleapis.com/fcm/send/abc", "https://127.0.0.1/", "https://fcm.googleapis.com.example.org/", "https://user@fcm.googleapis.com/"]:
            with self.assertRaises(ValueError):
                validate_endpoint(url)
