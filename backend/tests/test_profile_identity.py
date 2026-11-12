"""Privacy boundary integration tests against migrated PostgreSQL; rolled back."""
import asyncio
from datetime import datetime, timezone
import unittest
from unittest.mock import AsyncMock, patch
import uuid
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.db import engine, get_db
from app.main import app, optional_user, public_profile, public_profile_posts, notification_to_public
from app.chat.routes import chat_user
from app.chat.service import get_conversation_detail, get_conversation_messages, get_user_conversations
from app.chat.identity import anonymous_id
from app.chat.websocket_handler import handle_chat_message_send, handle_chat_typing_start, handle_chat_typing_stop
from app.models import User, Post, ChatConversation, ChatParticipant, Notification, UserBlock, SameSkyMatch
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
