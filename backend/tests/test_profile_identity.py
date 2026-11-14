"""Privacy boundary integration tests against migrated PostgreSQL; rolled back."""
import asyncio
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import AsyncMock, patch
import uuid
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.activity import record_activity
from app.db import engine, get_db
from app.config import settings
from app.security import make_token
from app.main import app, current_user, optional_user, public_profile, public_profile_posts, notification_to_public
from app.chat.routes import chat_user
from app.chat.service import get_conversation_detail, get_conversation_messages, get_user_conversations
from app.chat.identity import anonymous_id
from app.chat.websocket_handler import handle_chat_message_send, handle_chat_typing_start, handle_chat_typing_stop
from app.models import User, Post, ChatConversation, ChatParticipant, Notification, UserBlock, SameSkyMatch, SameSkyJob, PostHistory, Comment
from app.same_sky_common import _match_out


class ProfileIdentityTests(unittest.TestCase):
    def setUp(self):
        self.connection = engine.connect()
        self.transaction = self.connection.begin()
        self.db = Session(bind=self.connection, join_transaction_mode="create_savepoint")
        self.users = []
        for i in range(3):
            name = 'privacy_' + uuid.uuid4().hex[:10]
            row = User(id=uuid.uuid4(), username=name, username_lower=name, email=name+'@example.com',
                       bio='Identifying biography', avatar_file='identifying.png', password_hash='test')
            self.db.add(row); self.users.append(row)
        self.db.flush()
        self.a, self.b, self.outsider = self.users
        self.match = SameSkyMatch(id=uuid.uuid4(), user_a_id=min(self.a.id,self.b.id), user_b_id=max(self.a.id,self.b.id), initiated_by_id=self.a.id,
            status='connected', similarity_score=.8, safe_explanation='Shared themes', shared_themes=[])
        self.db.add(self.match); self.db.flush()
        now = datetime.now(timezone.utc)
        self.conv = ChatConversation(id=uuid.uuid4(), same_sky_match_id=self.match.id, last_message_at=now)
        self.db.add(self.conv);self.db.flush()
        self.pa = ChatParticipant(conversation_id=self.conv.id,user_id=self.a.id)
        self.pb = ChatParticipant(conversation_id=self.conv.id,user_id=self.b.id)
        self.db.add_all([self.pa,self.pb]);self.db.flush()
        self.viewer = self.a
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[chat_user] = lambda: self.viewer
        app.dependency_overrides[optional_user] = lambda: self.viewer
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        self.client.close();self.db.close();self.transaction.rollback();self.connection.close()

    def test_avatar_replacements_get_fresh_urls_and_upload_limits_are_per_account(self):
        app.dependency_overrides[current_user] = lambda: self.viewer

        def upload(data):
            return self.client.post("/profile/avatar", files={"file": ("photo.png", data, "image/png")})

        png = b"\x89PNG\r\n\x1a\n"
        with TemporaryDirectory() as directory, patch("app.main.AVATAR_DIR", Path(directory)):
            first = upload(png + b"first")
            self.assertEqual(first.status_code, 200, first.text)
            second = upload(png + b"\0" * 2_100_000)
            self.assertEqual(second.status_code, 200, second.text)
            first_name = Path(first.json()["avatar_url"]).name
            second_name = Path(second.json()["avatar_url"]).name
            self.assertNotEqual(first_name, second_name)
            self.assertFalse((Path(directory) / first_name).exists())
            self.assertEqual((Path(directory) / second_name).stat().st_size, len(png) + 2_100_000)

            self.assertEqual(upload(b"invalid").status_code, 400)
            self.assertEqual(upload(png + b"\0" * 8_000_000).status_code, 413)
            for _ in range(8):
                self.assertEqual(upload(png).status_code, 200)
            limited = upload(png)
            self.assertEqual(limited.status_code, 429)
            self.assertGreater(int(limited.headers["Retry-After"]), 0)
            self.viewer = self.b
            self.assertEqual(upload(png).status_code, 200)

    def test_post_gallery_preserves_order_and_deletes_all_files(self):
        app.dependency_overrides[current_user] = lambda: self.viewer
        png = b"\x89PNG\r\n\x1a\n"
        jpg = b"\xff\xd8\xff"
        fields = {"body": "Gallery photos", "category": "Random Thoughts", "mood": "soft"}
        with TemporaryDirectory() as directory, patch("app.main.POSTS_DIR", Path(directory)):
            first = ("images", ("first.png", png, "image/png"))
            invalid = ("images", ("invalid.jpg", b"invalid", "image/jpeg"))
            rejected = self.client.post("/posts", data=fields, files=[first, invalid])
            self.assertEqual(rejected.status_code, 400, rejected.text)
            self.assertEqual(list(Path(directory).iterdir()), [])
            second = ("images", ("second.jpg", jpg, "image/jpeg"))
            response = self.client.post("/posts", data=fields, files=[first, second])
            self.assertEqual(response.status_code, 200, response.text)
            post = response.json()
            self.assertEqual(post["image_url"], post["image_urls"][0])
            self.assertEqual([(Path(directory) / Path(url).name).read_bytes() for url in post["image_urls"]], [png, jpg])
            self.assertEqual(self.client.get(f'/posts/{post["id"]}').json()["image_urls"], post["image_urls"])
            self.assertEqual(self.client.delete(f'/posts/{post["id"]}').status_code, 200)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_public_profile_excludes_anonymous_private_and_email(self):
        for surface in ('feed','confession'):
            for anon, visibility in [(False,'public'),(True,'public'),(False,'private'),(True,'private')]:
                self.db.add(Post(author_id=self.b.id,body=f'{surface}:{anon}:{visibility}',category='Life',mood='soft',surface=surface,is_anonymous=anon,visibility=visibility))
        self.db.flush()
        profile=self.client.get(f'/users/{self.b.username}').json()
        self.assertNotIn('email',profile);self.assertNotIn('id',profile)
        for surface in ('feed','confession'):
            response=self.client.get(f'/users/{self.b.username}/posts?surface={surface}')
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual([p['body'] for p in response.json()['posts']],[f'{surface}:False:public'])
        # Even the owner cannot attribute anonymous stories on this public surface.
        self.viewer=self.b
        self.assertEqual(len(self.client.get(f'/users/{self.b.username}/posts').json()['posts']),1)
        self.db.add(UserBlock(blocker_id=self.a.id,blocked_id=self.b.id));self.db.flush()
        self.viewer=self.a
        self.assertEqual(self.client.get(f'/users/{self.b.username}').status_code,404)
        self.assertEqual(self.client.get(f'/users/{self.b.username}/posts').status_code,404)

    def test_admin_story_lists_include_private_and_anonymous_with_access_control(self):
        for surface in ("feed", "confession"):
            self.db.add_all([
                Post(author_id=self.b.id, body=f"{surface}:public", category="Life", mood="soft", surface=surface),
                Post(author_id=self.b.id, body=f"{surface}:private", category="Life", mood="soft", surface=surface,
                     visibility="private", is_anonymous=True, image_file="fixture.png"),
            ])
        self.db.flush()
        path = f"/admin/users/{self.b.id}/stories"
        with patch.object(settings, "admin_emails", self.a.email):
            self.assertEqual(self.client.get(path).status_code, 401)
            self.client.cookies.set("fml_session", make_token(self.outsider.id))
            self.assertEqual(self.client.get(path).status_code, 403)
            self.client.cookies.set("fml_session", make_token(self.a.id))
            for surface in ("feed", "confession"):
                first = self.client.get(path, params={"surface": surface, "limit": 1})
                self.assertEqual(first.status_code, 200)
                self.assertIn("no-store", first.headers["Cache-Control"])
                data = first.json()
                second = self.client.get(path, params={"surface": surface, "limit": 1, "cursor": data["next_cursor"]}).json()
                rows = data["posts"] + second["posts"]
                self.assertEqual({row["body"] for row in rows}, {f"{surface}:public", f"{surface}:private"})
                private = next(row for row in rows if row["visibility"] == "private")
                self.assertTrue(private["is_anonymous"])
                self.assertTrue(private["image_url"].startswith("/admin/stories/"))
                self.assertIsNone(second["next_cursor"])
            self.client.cookies.clear()
            self.assertEqual(self.client.get(private["image_url"]).status_code, 401)

    def test_last_active_write_is_throttled_by_the_database(self):
        self.assertIsNone(self.b.last_active_at)
        with patch("app.activity.SessionLocal.begin", return_value=nullcontext(self.db)):
            record_activity(self.b.id)
            self.db.refresh(self.b)
            first = self.b.last_active_at
            self.assertIsNotNone(first)
            self.db.execute(User.__table__.update().where(User.id == self.b.id)
                            .values(last_active_at=first.replace(microsecond=0)))
            record_activity(self.b.id)
            self.db.refresh(self.b)
            self.assertEqual(self.b.last_active_at, first.replace(microsecond=0))

    def test_admin_comments_and_activity_are_owner_only(self):
        self.b.last_active_at = datetime.now(timezone.utc)
        post = Post(author_id=self.outsider.id, body="Private story", category="Life", mood="soft",
                    surface="confession", visibility="private")
        self.db.add(post)
        self.db.flush()
        root = Comment(post_id=post.id, author_id=self.b.id, body="Anonymous comment", is_anonymous=True)
        self.db.add(root)
        self.db.flush()
        reply = Comment(post_id=post.id, author_id=self.b.id, parent_id=root.id, body="Reply")
        deleted = Comment(post_id=post.id, author_id=self.b.id, body="", deleted_at=self.b.last_active_at)
        self.db.add_all([reply, deleted])
        self.db.flush()

        path = f"/admin/users/{self.b.id}"
        with patch.object(settings, "admin_emails", self.a.email):
            self.assertEqual(self.client.get(path + "/comments").status_code, 401)
            self.client.cookies.set("fml_session", make_token(self.outsider.id))
            self.assertEqual(self.client.get(path + "/comments").status_code, 403)
            self.client.cookies.set("fml_session", make_token(self.a.id))
            first = self.client.get(path + "/comments", params={"limit": 1})
            self.assertEqual(first.status_code, 200, first.text)
            self.assertIn("no-store", first.headers["Cache-Control"])
            page = first.json()
            second = self.client.get(path + "/comments", params={"limit": 1, "cursor": page["next_cursor"]}).json()
            self.assertIsNone(second["next_cursor"])
            rows = {row["body"]: row for row in page["comments"] + second["comments"]}
            self.assertEqual(set(rows), {"Anonymous comment", "Reply"})
            self.assertTrue(rows["Anonymous comment"]["is_anonymous"])
            self.assertTrue(rows["Reply"]["is_reply"])
            self.assertEqual(rows["Reply"]["visibility"], "private")
            detail = self.client.get(path).json()
            self.assertEqual(detail["comments_count"], 2)
            listing = self.client.get("/admin/users", params={"q": self.b.username}).json()["users"][0]
            self.assertEqual(datetime.fromisoformat(detail["last_active_at"].replace("Z", "+00:00")), self.b.last_active_at)
            self.assertEqual(datetime.fromisoformat(listing["last_active_at"].replace("Z", "+00:00")), self.b.last_active_at)

    def test_owner_can_delete_post_and_remove_its_queued_analysis(self):
        post = Post(author_id=self.a.id, body="Delete me", category="Life", mood="soft")
        self.db.add(post)
        self.db.flush()
        post_id = post.id
        queued = SameSkyJob(job_type="analyze_post", payload={"post_id": str(post_id)})
        unrelated = SameSkyJob(job_type="analyze_post", payload={"post_id": str(uuid.uuid4())})
        self.db.add_all([queued, unrelated])
        self.db.flush()
        queued_id, unrelated_id = queued.id, unrelated.id
        app.dependency_overrides[current_user] = lambda: self.a

        response = self.client.delete(f"/posts/{post_id}")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(self.db.get(Post, post_id))
        self.assertIsNone(self.db.get(SameSkyJob, queued_id))
        self.assertIsNotNone(self.db.get(SameSkyJob, unrelated_id))
        self.assertIsNotNone(self.db.scalar(select(PostHistory).where(PostHistory.original_id == post_id)))

    def test_story_link_resolves_older_reply_and_enforces_privacy(self):
        from datetime import timedelta

        public = Post(author_id=self.b.id, body="Shared", category="Life", mood="soft", is_anonymous=True)
        private = Post(author_id=self.b.id, body="Private", category="Life", mood="soft", visibility="private")
        self.db.add_all([public, private])
        self.db.flush()
        now = datetime.now(timezone.utc)
        root = Comment(post_id=public.id, author_id=self.b.id, body="Older", created_at=now - timedelta(days=1))
        newest = Comment(post_id=public.id, author_id=self.a.id, body="Newest", created_at=now)
        self.db.add_all([root, newest])
        self.db.flush()
        reply = Comment(post_id=public.id, author_id=self.a.id, parent_id=root.id, body="Linked reply")
        self.db.add(reply)
        self.db.flush()

        story = self.client.get(f"/posts/{public.id}")
        self.assertEqual(story.status_code, 200)
        self.assertIsNone(story.json()["author"])
        response = self.client.get(f"/posts/{public.id}/comments", params={"focus": str(reply.id), "limit": 1})
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()["comments"]
        self.assertEqual(rows[0]["id"], str(root.id))
        self.assertEqual(rows[0]["replies"][0]["id"], str(reply.id))
        self.assertEqual(self.client.get(f"/posts/{private.id}").status_code, 404)
        self.assertEqual(self.client.get(f"/posts/{private.id}/comments").status_code, 404)
        self.viewer = self.b
        self.assertEqual(self.client.get(f"/posts/{private.id}").status_code, 200)

    def test_anonymous_post_op_badge_keeps_author_private(self):
        post = Post(author_id=self.b.id, body="Anonymous story", category="Life", mood="soft", is_anonymous=True)
        self.db.add(post)
        self.db.flush()
        legacy = Comment(post_id=post.id, author_id=self.b.id, body="Old comment", is_anonymous=False)
        self.db.add(legacy)
        self.db.flush()
        app.dependency_overrides[current_user] = lambda: self.viewer
        path = f"/posts/{post.id}/comments"

        reply = self.client.post(path, json={"body": "Reply to OP", "parent_id": str(legacy.id)}).json()
        self.assertEqual(reply["reply_to"], "Anonymous")
        self.viewer = self.b
        response = self.client.post(path, json={"body": "OP reply", "parent_id": reply["id"], "is_anonymous": False})
        self.assertEqual(response.status_code, 200, response.text)
        op_reply = response.json()
        self.assertTrue(op_reply["is_op"])
        self.assertTrue(op_reply["is_anonymous"])
        self.assertIsNone(op_reply["author"])
        self.assertEqual(op_reply["anonymous_number"], 1)

        self.viewer = self.a
        root = self.client.get(path).json()["comments"][0]
        self.assertTrue(root["is_op"])
        self.assertIsNone(root["author"])
        self.assertEqual(root["replies"][0]["reply_to"], "Anonymous #1")
        notifications = self.client.get("/notifications").json()["notifications"]
        notice = next(item for item in notifications if item["comment_id"] == op_reply["id"])
        self.assertIsNone(notice["actor"])

    def test_comment_conversations_keep_post_scoped_aliases_and_deep_replies(self):
        post = Post(author_id=self.b.id, body="Conversations", category="Life", mood="soft")
        other = Post(author_id=self.b.id, body="Another post", category="Life", mood="soft", surface="confession")
        self.db.add_all([post, other])
        self.db.flush()
        app.dependency_overrides[current_user] = lambda: self.viewer
        path = f"/posts/{post.id}/comments"
        other_path = f"/posts/{other.id}/comments"

        def add(viewer, path, body, parent=None, anonymous=True):
            self.viewer = viewer
            response = self.client.post(path, json={"body": body, "parent_id": parent, "is_anonymous": anonymous})
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()

        root = add(self.a, path, "First conversation")
        reply = add(self.b, path, "First reply", root["id"])
        nested = add(self.a, path, "Nested reply", reply["id"])
        deep = add(self.outsider, path, "Deep reply", nested["id"], anonymous=False)
        separate = add(self.b, path, "Independent conversation")
        self.assertEqual([row["anonymous_number"] for row in (root, reply, nested, separate)], [1, 2, 1, 2])
        self.assertEqual(nested["reply_to"], "Anonymous #2")
        self.assertEqual(deep["reply_to"], "Anonymous #1")
        self.assertFalse(root["is_op"])
        self.assertTrue(reply["is_op"])
        named_op = add(self.b, other_path, "Named OP reply", anonymous=False)
        self.assertTrue(named_op["is_op"])
        self.assertEqual(named_op["author"]["username"], self.b.username)
        self.assertEqual(add(self.b, other_path, "First here")["anonymous_number"], 1)
        self.assertEqual(add(self.a, other_path, "Second here")["anonymous_number"], 2)
        self.assertEqual(self.client.post(other_path, json={"body": "Cross-post reply", "parent_id": nested["id"]}).status_code, 404)

        # Equal timestamps still paginate each conversation exactly once.
        stamp = datetime.now(timezone.utc)
        for row in self.db.scalars(select(Comment).where(Comment.post_id == post.id)):
            row.created_at = stamp
        self.db.flush()
        first_page = self.client.get(path, params={"limit": 1}).json()
        next_page = self.client.get(path, params={"limit": 1, "cursor": first_page["next_cursor"]}).json()
        self.assertEqual({first_page["comments"][0]["id"], next_page["comments"][0]["id"]}, {root["id"], separate["id"]})
        self.assertIsNone(next_page["next_cursor"])

        self.viewer = None
        focused = self.client.get(path, params={"focus": deep["id"], "limit": 1}).json()["comments"][0]
        self.assertEqual(focused["id"], root["id"])
        self.assertEqual([row["id"] for row in focused["replies"]], [reply["id"], nested["id"], deep["id"]])
        for row in [focused, *focused["replies"][:2]]:
            self.assertIsNone(row["author"])
            self.assertFalse(row["is_mine"])
        notice = self.db.scalar(select(Notification).where(Notification.comment_id == uuid.UUID(deep["id"])))
        self.assertEqual(notice.recipient_id, self.a.id)

        self.viewer = self.b
        self.assertEqual(self.client.delete(f"/comments/{reply['id']}").status_code, 200)
        self.viewer = self.a
        self.assertEqual(self.client.delete(f"/comments/{root['id']}").status_code, 200)
        data = self.client.get(path, params={"focus": deep["id"]}).json()
        retained = next(row for row in data["comments"] if row["id"] == root["id"])
        self.assertTrue(retained["is_deleted"])
        self.assertEqual(retained["body"], "")
        self.assertIsNone(retained["anonymous_number"])
        self.assertEqual(retained["replies"][1]["reply_to"], "Deleted comment")
        self.assertEqual(retained["replies"][2]["id"], deep["id"])
        self.assertEqual(data["comment_count"], 3)
        self.assertEqual(self.client.get(f"/posts/{post.id}").json()["comment_count"], 3)
        self.assertEqual(add(self.a, path, "Still number one")["anonymous_number"], 1)

        self.viewer = self.b
        self.assertEqual(self.client.delete(f"/posts/{post.id}").status_code, 200)
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_share_count_counts_distinct_signed_in_users_per_public_story(self):
        for surface in ("feed", "confession"):
            story = Post(author_id=self.b.id, body="Share test", category="Life", mood="soft", surface=surface)
            self.db.add(story)
            self.db.flush()
            path = f"/posts/{story.id}"
            for viewer, count in ((None, 0), (self.a, 1), (self.a, 1), (self.outsider, 2), (self.outsider, 2)):
                self.viewer = viewer
                response = self.client.post(path + "/share")
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["share_count"], count)
            self.assertEqual(self.client.get(path).json()["share_count"], 2)
            story.visibility = "private"
            self.db.flush()
            self.assertEqual(self.client.post(path + "/share").status_code, 404)

    def test_only_author_can_edit_posts_and_confessions(self):
        from app.same_sky_api import include_post_for_matching

        app.dependency_overrides[current_user] = lambda: self.viewer
        for surface in ("feed", "confession"):
            post = Post(author_id=self.b.id, body="Original", category="Life", mood="soft",
                        surface=surface, visibility="private", is_anonymous=True)
            self.db.add(post)
            self.db.flush()
            analysis = include_post_for_matching(self.db, self.b, post)
            fingerprint = analysis.analysis_fingerprint
            path = f"/posts/{post.id}"
            self.viewer = self.a
            self.assertEqual(self.client.patch(path, json={"body": "Other account"}).status_code, 404)
            self.viewer = self.b
            self.assertEqual(self.client.patch(path, json={"body": "  "}).status_code, 422)
            result = self.client.patch(path, json={"body": " Updated text "})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()["body"], "Updated text")
            self.assertEqual(result.json()["visibility"], "private")
            self.assertTrue(result.json()["is_anonymous"])
            self.assertNotEqual(analysis.analysis_fingerprint, fingerprint)
            jobs = self.db.scalars(select(SameSkyJob).where(
                SameSkyJob.payload["post_id"].as_string() == str(post.id),
                SameSkyJob.status == "queued",
            )).all()
            self.assertEqual(len(jobs), 1)

    def test_nickname_one_sided_reveal_and_withdrawal(self):
        path=f'/chat/conversations/{self.conv.id}'
        initial=self.client.get(path).json()
        other=initial['other_user']
        self.assertNotIn(self.b.username,str(other));self.assertNotIn(str(self.b.id),str(other))
        self.assertIsNone(other['avatar_url']);self.assertEqual(other['bio'],'')
        self.assertEqual(other['user_id'],str(anonymous_id(self.match.id,self.b.id)))
        with patch('app.chat.routes.ws_manager.send_to_users',new_callable=AsyncMock):
            r=self.client.patch(path+'/identity',json={'nickname':'My friend'})
            self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(r.json()['other_user']['username'],'My friend')
            self.viewer=self.b
            self.assertNotEqual(self.client.get(path).json()['other_user']['username'],'My friend')
            r=self.client.patch(path+'/identity',json={'profile_revealed':True})
            self.assertEqual(r.status_code,200,r.text)
            self.assertFalse(r.json()['other_user']['is_revealed'])
            self.viewer=self.a
            detail=self.client.get(path).json()
            self.assertTrue(detail['other_user']['is_revealed'])
            self.assertEqual(detail['other_user']['profile_username'],self.b.username)
            self.assertEqual(detail['other_user']['username'],'My friend')
            self.viewer=self.b
            self.client.patch(path+'/identity',json={'profile_revealed':False})
            self.viewer=self.a
            detail=self.client.get(path).json()
            self.assertFalse(detail['other_user']['is_revealed']);self.assertIsNone(detail['other_user']['profile_username'])
            self.client.patch(path+'/identity',json={'nickname':''})
            self.assertEqual(self.client.get(path).json()['other_user']['username'],other['alias'])
        self.viewer=self.outsider
        self.assertEqual(self.client.get(path).status_code,403)
        self.assertEqual(self.client.patch(path+'/identity',json={'profile_revealed':True}).status_code,403)

    def test_rest_messages_history_summary_match_and_notifications_hide_identity(self):
        self.viewer=self.b
        with patch('app.chat.routes.ws_manager.send_to_user',new_callable=AsyncMock) as send:
            response=self.client.post(f'/chat/conversations/{self.conv.id}/messages',json={'content':'Hello'})
            self.assertEqual(response.status_code,200,response.text)
            recipient_message=send.call_args.kwargs['data']['message']
            self.assertNotEqual(recipient_message['sender_username'],self.b.username)
            self.assertNotEqual(recipient_message['sender_id'],str(self.b.id))
        for result in [get_conversation_messages(self.db,self.conv.id,self.a.id).model_dump(mode='json'),
                       get_user_conversations(self.db,self.a.id)[0].model_dump(mode='json'),
                       _match_out(self.match,self.a,self.b,self.conv.id).model_dump(mode='json')]:
            self.assertNotIn(self.b.username,str(result));self.assertNotIn(str(self.b.id),str(result))
        notification=Notification(id=uuid.uuid4(),recipient_id=self.a.id,actor_id=self.b.id,kind='same_sky_connected',same_sky_match_id=self.match.id)
        self.db.add(notification);self.db.flush()
        public=notification_to_public(notification)
        self.assertIsNone(public.actor);self.assertTrue(public.is_anonymous)

    def test_websocket_messages_and_typing_are_viewer_specific(self):
        connection=AsyncMock();connection.user_id=self.b.id
        with patch('app.chat.websocket_handler.SessionLocal') as sessions, patch('app.chat.websocket_handler.ws_manager') as manager:
            sessions.return_value.__enter__.return_value=self.db
            sessions.return_value.__exit__.return_value=False
            manager.is_user_online.return_value=True
            manager.send_to_user=AsyncMock()
            asyncio.run(handle_chat_message_send(connection,{'conversation_id':str(self.conv.id),'content':'Hello'},'event'))
            payload=manager.send_to_user.call_args.kwargs['data']['message']
            self.assertNotEqual(payload['sender_username'],self.b.username)
            self.assertNotEqual(payload['sender_id'],str(self.b.id))
            asyncio.run(handle_chat_typing_start(connection,{'conversation_id':str(self.conv.id)},'typing'))
            typing=manager.send_to_user.call_args.kwargs['data']
            self.assertNotEqual(typing['username'],self.b.username)
            self.assertNotEqual(typing['user_id'],str(self.b.id))
            connection.user_id=self.outsider.id
            with self.assertRaises(HTTPException):
                asyncio.run(handle_chat_typing_stop(connection,{'conversation_id':str(self.conv.id)},'typing'))

    def test_profile_pagination_and_identity_scope(self):
        for i in range(3):
            self.db.add(Post(author_id=self.b.id,body=str(i),category='Life',mood='soft',is_anonymous=False,visibility='public'))
        self.db.flush()
        path=f'/users/{self.b.username}/posts?limit=2'
        first=self.client.get(path).json()
        second=self.client.get(path, params={'cursor': first['next_cursor']}).json()
        self.assertEqual(len(first['posts']),2);self.assertEqual(len(second['posts']),1)
        self.assertFalse({p['id'] for p in first['posts']} & {p['id'] for p in second['posts']})
        self.assertNotEqual(anonymous_id(self.match.id,self.b.id), anonymous_id(uuid.uuid4(),self.b.id))
        self.assertEqual(self.client.get(path+'&cursor=bad').status_code,400)

    def test_presence_uses_scoped_ids_and_blocking_closes_access(self):
        from app.websocket.endpoint import handle_presence_query
        connection=AsyncMock();connection.user_id=self.a.id
        scoped=anonymous_id(self.match.id,self.b.id)
        with patch('app.db.SessionLocal') as sessions:
            sessions.return_value.__enter__.return_value=self.db
            sessions.return_value.__exit__.return_value=False
            with patch('app.websocket.manager.ws_manager.is_user_online', return_value=True):
                asyncio.run(handle_presence_query(connection,{'user_ids':[str(scoped),str(self.b.id)]},'presence'))
            payload=connection.send_event.call_args.kwargs['data']
            self.assertEqual(payload['online_user_ids'],[str(scoped)])
        self.db.add(UserBlock(blocker_id=self.b.id,blocked_id=self.a.id));self.db.flush()
        path=f'/chat/conversations/{self.conv.id}'
        self.assertEqual(self.client.get(path).status_code,403)
        self.assertEqual(self.client.get(path+'/messages').status_code,403)
        self.assertEqual(self.client.patch(path+'/identity',json={'profile_revealed':True}).status_code,403)
        self.assertEqual(self.client.get('/chat/conversations').json(),[])

if __name__=='__main__': unittest.main()
