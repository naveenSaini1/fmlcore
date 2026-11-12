"""Opt-in Web Push. Payloads never contain names, story text or chat content."""
import asyncio
import base64
from datetime import datetime, timedelta, timezone
import hmac
import json
import logging
from urllib.parse import urlsplit

import requests

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db, SessionLocal
from app.limiter import limit
from app.models import BrowserPushSubscription, BrowserPushDelivery, ChatMessage, ChatParticipant, Notification, User
from app.safety import can_notify
from app.security import read_user_id

router = APIRouter(prefix='/browser-push', tags=['browser notifications'])
logger = logging.getLogger(__name__)


def ready() -> bool:
    return bool(settings.web_push_public_key and settings.web_push_private_key and settings.web_push_subject)


def validate_endpoint(value: str) -> str:
    try:
        url = urlsplit(value)
        host = url.hostname or ''
        valid_host = host in {'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'} or host.endswith('.push.services.mozilla.com')
        if url.scheme != 'https' or not valid_host or url.username or url.password or url.port not in (None, 443) or url.fragment:
            raise ValueError('Unsupported browser push endpoint.')
    except (ValueError, TypeError):
        raise ValueError('Unsupported browser push endpoint.') from None
    return value


class EndpointIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=4096)
    _endpoint = field_validator('endpoint')(validate_endpoint)


class SubscriptionIn(EndpointIn):
    keys: dict[str, str]

    @field_validator('keys')
    @classmethod
    def validate_keys(cls, keys):
        try:
            decoded = {name: base64.urlsafe_b64decode(keys[name] + '=' * (-len(keys[name]) % 4)) for name in ('auth', 'p256dh')}
            if len(decoded['auth']) != 16 or len(decoded['p256dh']) != 65 or decoded['p256dh'][0] != 4:
                raise ValueError()
        except (KeyError, ValueError, TypeError):
            raise ValueError('Invalid browser subscription keys.') from None
        return {name: keys[name] for name in ('auth', 'p256dh')}


def push_user(request: Request, db: Session = Depends(get_db)):
    if request.method != 'GET' and request.headers.get('origin') not in settings.cors_origin_list:
        raise HTTPException(403, 'This browser notification request is not allowed.')
    user = db.get(User, read_user_id(request))
    if not user:
        raise HTTPException(401, 'Log in again.')
    return user


@router.get('/config')
def config():
    return {'enabled': ready(), 'public_key': settings.web_push_public_key if ready() else None}


@router.post('/subscriptions')
def subscribe(body: SubscriptionIn, request: Request, db: Session = Depends(get_db), user: User = Depends(push_user)):
    limit(request, 'push_subscribe', max_hits=30, window_seconds=600)
    if not ready():
        raise HTTPException(503, 'Browser notifications are not configured yet.')
    old = db.scalar(select(BrowserPushSubscription).where(BrowserPushSubscription.endpoint == body.endpoint).with_for_update())
    if old:
        if old.user_id != user.id:
            # The same browser can switch accounts; require its existing keys,
            # then cascade away the previous account's queued deliveries.
            if any(not hmac.compare_digest(old.keys.get(k, ''), body.keys[k]) for k in ('auth', 'p256dh')):
                raise HTTPException(409, 'Please reset browser notifications and try again.')
            db.delete(old)
            db.flush()
        else:
            old.keys = body.keys
            db.commit()
            return {'ok': True}
    count = db.scalar(select(func.count(BrowserPushSubscription.id)).where(BrowserPushSubscription.user_id == user.id))
    if count >= 10:
        raise HTTPException(409, 'You have reached the limit of ten notification devices.')
    db.add(BrowserPushSubscription(user_id=user.id, endpoint=body.endpoint, keys=body.keys))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Please retry enabling browser notifications.') from None
    return {'ok': True}


@router.post('/subscriptions/status')
def subscription_status(body: EndpointIn, db: Session = Depends(get_db), user: User = Depends(push_user)):
    subscription_id = db.scalar(select(BrowserPushSubscription.id).where(
        BrowserPushSubscription.endpoint == body.endpoint,
        BrowserPushSubscription.user_id == user.id,
    ))
    return {'enabled': subscription_id is not None}


@router.delete('/subscriptions')
def unsubscribe(body: EndpointIn, db: Session = Depends(get_db), user: User = Depends(push_user)):
    row = db.scalar(select(BrowserPushSubscription).where(BrowserPushSubscription.endpoint == body.endpoint, BrowserPushSubscription.user_id == user.id))
    if row:
        db.delete(row)
        db.commit()
    return {'ok': True}


def delivery_allowed(db, job, subscription):
    if job.notification_id:
        note = db.get(Notification, job.notification_id)
        if not note or note.is_read or note.recipient_id != subscription.user_id:
            return False
        return not note.actor_id or can_notify(db, note.recipient_id, note.actor_id)
    message = db.get(ChatMessage, job.message_id) if job.message_id else None
    if not message or not can_notify(db, subscription.user_id, message.sender_id):
        return False
    part = db.scalar(select(ChatParticipant).where(ChatParticipant.user_id == subscription.user_id, ChatParticipant.conversation_id == message.conversation_id))
    return bool(part and not part.muted and (not part.last_read_at or part.last_read_at < message.created_at))


class PushHttpSession(requests.Session):
    def send(self, request, **kwargs):
        # Do not follow an endpoint's redirect to an unapproved destination.
        kwargs["allow_redirects"] = False
        return super().send(request, **kwargs)


def process_push_job() -> bool:
    if not ready():
        return False
    from pywebpush import webpush, WebPushException
    with SessionLocal() as db:
        now = datetime.now(timezone.utc)
        job = db.scalar(select(BrowserPushDelivery).where(BrowserPushDelivery.run_after <= now).order_by(BrowserPushDelivery.run_after).with_for_update(skip_locked=True).limit(1))
        if not job:
            return False
        subscription = db.get(BrowserPushSubscription, job.subscription_id)
        if not subscription or job.created_at < now - timedelta(hours=24) or not delivery_allowed(db, job, subscription):
            db.delete(job)
            db.commit()
            return True
        payload = {'title': 'FMLCore', 'body': 'You have new activity. Open FMLCore to see it.', 'url': '/chat' if job.message_id else '/notifications', 'tag': 'fmlcore-activity'}
        try:
            validate_endpoint(subscription.endpoint)
            with PushHttpSession() as http:
                webpush(
                    subscription_info={'endpoint': subscription.endpoint, 'keys': subscription.keys},
                    data=json.dumps(payload),
                    vapid_private_key=settings.web_push_private_key,
                    vapid_claims={'sub': settings.web_push_subject},
                    timeout=10,
                    ttl=3600,
                    requests_session=http,
                )
        except (WebPushException, requests.RequestException, ValueError) as exc:
            response = getattr(exc, "response", None)
            status = response.status_code if response is not None else None
            if status in (404, 410):
                db.delete(subscription)
            elif job.attempts >= 4:
                db.delete(job)
                logger.warning('Browser push delivery exhausted retries (status %s)', status)
            else:
                job.attempts += 1
                job.run_after = now + timedelta(seconds=min(60 * 2 ** job.attempts, 1800))
        else:
            db.delete(job)
        db.commit()
    return True


async def delivery_loop(push_wake: asyncio.Event):
    while True:
        push_wake.clear()
        try:
            while await asyncio.to_thread(process_push_job):
                await asyncio.sleep(0)
        except Exception:
            # Never log subscription endpoints, payloads or keys.
            logger.warning('Browser push delivery temporarily unavailable; retrying.')
        try:
            await asyncio.wait_for(push_wake.wait(), timeout=30)
        except asyncio.TimeoutError:
            pass
