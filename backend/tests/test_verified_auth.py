"""Integration tests use migrated PostgreSQL and roll back every test account.

Run: python -m unittest discover -s tests -v
SMTP and Google's remote token verification are replaced by deterministic fakes.
"""
from datetime import timedelta
import re
import unittest
from unittest.mock import patch
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import engine, get_db
from app.email_service import EmailDeliveryError, OutboundEmail, SMTPEmailSender
from app.email_verification import FLOW_COOKIE, digest, now
from app.limiter import _hits
from app.main import app
from app.models import AuthChallenge, EmailDeliveryQuota, User
from app.security import hash_password


class VerifiedAuthTests(unittest.TestCase):
    def setUp(self):
        self.connection = engine.connect()
        self.transaction = self.connection.begin()
        self.messages = []
        def db_override():
            with Session(bind=self.connection, join_transaction_mode="create_savepoint") as session:
                yield session
        app.dependency_overrides[get_db] = db_override
        self.client = TestClient(app, headers={"origin": "http://localhost:3000"})
        self.patches = [patch("app.email_verification.email_sender.send", side_effect=self.messages.append),
            patch.object(settings, "google_client_id", "test.apps.googleusercontent.com"),
            patch.object(settings, "email_otp_every_login", True)]
        for item in self.patches:
            item.start()
        _hits.clear()
        self.email = f"auth-{uuid.uuid4().hex[:12]}@example.com"
        self.username = "test_" + uuid.uuid4().hex[:10]

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        for item in reversed(self.patches):
            item.stop()
        self.transaction.rollback()
        self.connection.close()

    def query(self, model, **kwargs):
        with Session(bind=self.connection, join_transaction_mode="create_savepoint") as session:
            return session.scalar(select(model).filter_by(**kwargs))

    def change(self, model, key, **changes):
        with Session(bind=self.connection, join_transaction_mode="create_savepoint") as session:
            row = session.get(model, key)
            for name, value in changes.items():
                setattr(row, name, value)
            session.commit()

    def signup(self, **changes):
        body = dict(email=self.email, username=self.username, password="safe password 123", age_confirmed=True)
        body.update(changes)
        return self.client.post("/auth/signup", json=body)

    def code(self):
        return re.search(r"code is (\d{6})", self.messages[-1].text).group(1)

    def verify(self, flow, code=None, client=None):
        return (client or self.client).post("/auth/email/verify", json={"challenge_id": flow["challenge_id"], "code": code or self.code()})

    def create_password_user(self, **changes):
        user = User(id=uuid.uuid4(), email=self.email, username=self.username,
            username_lower=self.username.lower(), password_hash=hash_password("safe password 123"),
            email_verified_at=None, **changes)
        with Session(bind=self.connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
            session.add(user)
            session.commit()
        return user

    def google(self, **changes):
        flow = self.client.post("/auth/google/start").json()
        claims = {"sub": "google-" + uuid.uuid4().hex, "email": self.email, "email_verified": True, "nonce": flow["nonce"]}
        claims.update(changes)
        with patch("app.auth_api.id_token.verify_oauth2_token", return_value=claims) as verifier:
            result = self.client.post("/auth/google", json={"challenge_id": flow["challenge_id"], "credential": "test-google-credential"})
            self.assertEqual(verifier.call_args.args[2], settings.google_client_id)
        return result, claims, flow

    def test_signup_waits_for_verified_email_and_code_is_not_stored(self):
        result = self.signup()
        self.assertEqual(result.status_code, 200)
        flow = result.json()
        self.assertTrue(flow["requires_verification"])
        self.assertIsNone(self.query(User, email=self.email))
        self.assertNotIn("fml_session", self.client.cookies)
        challenge = self.query(AuthChallenge, id=uuid.UUID(flow["challenge_id"]))
        self.assertNotIn(self.code(), str(challenge.payload))
        self.assertNotEqual(challenge.code_digest, self.code())
        self.assertNotIn("safe password 123", str(challenge.payload))
        with patch.object(settings, "email_otp_every_login", False):
            before_verification = self.client.post("/auth/login", json={"email": self.email, "password": "safe password 123"})
        self.assertEqual(before_verification.status_code, 401)
        verified = self.verify(flow)
        self.assertEqual(verified.status_code, 200, verified.text)
        self.assertIn("fml_session", self.client.cookies)
        self.assertIsNotNone(self.query(User, email=self.email).email_verified_at)
        self.assertEqual(self.client.get("/auth/me").json()["username"], self.username)
        self.assertEqual(self.verify(flow).status_code, 400)

    def test_wrong_codes_are_bounded_and_expired_codes_rejected(self):
        flow = self.signup().json()
        wrong = "000000" if self.code() != "000000" else "999999"
        for _ in range(settings.email_otp_max_attempts):
            self.assertEqual(self.verify(flow, wrong).status_code, 400)
        self.assertEqual(self.verify(flow).status_code, 400)
        self.change(AuthChallenge, uuid.UUID(flow["challenge_id"]), attempts=0, expires_at=now() - timedelta(seconds=1))
        self.assertEqual(self.verify(flow).status_code, 400)
        self.assertNotIn("fml_session", self.client.cookies)

    def test_code_is_browser_bound(self):
        flow = self.signup().json()
        with TestClient(app) as other:
            self.assertEqual(self.verify(flow, client=other).status_code, 400)
        self.assertEqual(self.verify(flow).status_code, 200)

    def test_resend_throttle_and_old_code_invalidation(self):
        flow = self.signup().json()
        first_code = self.code()
        self.assertEqual(self.client.post("/auth/email/resend", json={"challenge_id": flow["challenge_id"]}).status_code, 429)
        self.change(EmailDeliveryQuota, digest("recipient:" + self.email), last_sent_at=now() - timedelta(seconds=61))
        with patch("app.email_verification.secrets.randbelow", return_value=(int(first_code) + 1) % 1000000):
            result = self.client.post("/auth/email/resend", json={"challenge_id": flow["challenge_id"]})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.verify(flow, first_code).status_code, 400)
        self.assertEqual(self.verify(flow).status_code, 200)

    def test_login_requires_code_before_session_and_verifies_legacy_user(self):
        self.create_password_user()
        bad = self.client.post("/auth/login", json={"email": self.email, "password": "wrong"})
        self.assertEqual(bad.status_code, 401)
        result = self.client.post("/auth/login", json={"email": self.email.upper(), "password": "safe password 123"})
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()["requires_verification"])
        self.assertNotIn("fml_session", self.client.cookies)
        self.assertEqual(self.verify(result.json()).status_code, 200)
        self.assertIsNotNone(self.query(User, email=self.email).email_verified_at)

    def test_signup_only_policy_leaves_existing_accounts_unchanged(self):
        user = self.create_password_user()
        with patch.object(settings, "email_otp_every_login", False):
            result = self.client.post("/auth/login", json={"email": self.email, "password": "safe password 123"})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["id"], str(user.id))
            self.assertNotIn("requires_verification", result.json())
            self.assertIsNone(self.query(User, id=user.id).email_verified_at)
            self.assertEqual(len(self.messages), 0)
            self.assertIn("fml_session", self.client.cookies)

    def test_username_is_case_insensitive_and_validated(self):
        self.create_password_user()
        self.assertFalse(self.client.get("/auth/username-availability", params={"username": self.username.upper()}).json()["available"])
        self.assertEqual(self.signup(email="another@example.com", username=self.username.upper()).status_code, 409)
        for username in ["x", "two words", "not-valid!", "a" * 21]:
            self.assertEqual(self.signup(username=username).status_code, 422)
        self.assertEqual(self.signup(email="not an email").status_code, 422)
        self.assertEqual(self.signup(password="😀" * 20).status_code, 422)

    def test_username_conflict_at_final_verification_cannot_create_duplicate(self):
        flow = self.signup().json()
        original = self.email
        self.email = "other-" + self.email
        self.create_password_user()
        self.email = original
        self.assertEqual(self.verify(flow).status_code, 409)
        self.assertIsNone(self.query(User, email=self.email))

    def test_delivery_failure_does_not_create_account_or_session(self):
        with patch("app.email_verification.email_sender.send", side_effect=EmailDeliveryError("private SMTP details")):
            result = self.signup()
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("private SMTP details", result.text)
        self.assertIsNone(self.query(User, email=self.email))
        self.assertNotIn("fml_session", self.client.cookies)

    def test_google_nonce_replay_and_unverified_email_rejected(self):
        result, _, flow = self.google(nonce="wrong")
        self.assertEqual(result.status_code, 401)
        result, _, flow = self.google(email_verified=False)
        self.assertEqual(result.status_code, 401)
        result, claims, flow = self.google(email="verified-" + uuid.uuid4().hex + "@gmail.com")
        self.assertTrue(result.json()["requires_username"])
        self.assertNotIn("fml_session", self.client.cookies)
        with patch("app.auth_api.id_token.verify_oauth2_token", return_value=claims):
            self.assertEqual(self.client.post("/auth/google", json={"challenge_id": flow["challenge_id"], "credential": "replay"}).status_code, 400)

    def test_google_signup_requires_unique_username_and_age(self):
        result, claims, _ = self.google(email="new-" + uuid.uuid4().hex + "@gmail.com")
        flow = result.json()
        self.assertEqual(self.client.post("/auth/google/complete", json={"challenge_id": flow["challenge_id"], "username": self.username, "age_confirmed": False}).status_code, 422)
        result = self.client.post("/auth/google/complete", json={"challenge_id": flow["challenge_id"], "username": self.username, "age_confirmed": True})
        self.assertEqual(result.status_code, 200, result.text)
        user = self.query(User, email=claims["email"])
        self.assertEqual(user.google_subject, claims["sub"])
        self.assertIsNone(user.password_hash)
        self.assertIsNotNone(user.email_verified_at)
        self.assertEqual(self.client.post("/auth/login", json={"email": user.email, "password": "anything"}).status_code, 401)
        self.client.cookies.clear()
        result, _, _ = self.google(sub=claims["sub"], email=user.email)
        self.assertEqual(result.json()["id"], str(user.id))

    def test_google_existing_email_requires_otp_and_preserves_account(self):
        user = self.create_password_user()
        result, claims, _ = self.google()
        self.assertTrue(result.json()["requires_verification"])
        self.assertIsNone(self.query(User, id=user.id).google_subject)
        result = self.verify(result.json())
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["id"], str(user.id))
        self.assertEqual(self.query(User, id=user.id).google_subject, claims["sub"])

    def test_google_third_party_email_requires_otp(self):
        result, _, _ = self.google()
        result = self.client.post("/auth/google/complete", json={"challenge_id": result.json()["challenge_id"], "username": self.username, "age_confirmed": True})
        self.assertTrue(result.json()["requires_verification"])
        self.assertIsNone(self.query(User, email=self.email))
        self.assertEqual(self.verify(result.json()).status_code, 200)

    def test_cross_origin_auth_rejected(self):
        self.assertEqual(self.client.post("/auth/signup", headers={"origin": "https://unrelated.example"}, json={"email":self.email,"username":self.username,"password":"safe password 123","age_confirmed":True}).status_code, 403)

    def test_future_non_auth_codes_cannot_create_sessions(self):
        flow = self.signup().json()
        self.change(AuthChallenge, uuid.UUID(flow["challenge_id"]), purpose="password_reset")
        self.assertEqual(self.verify(flow).status_code, 400)
        self.assertEqual(self.client.post("/auth/email/resend", json={"challenge_id": flow["challenge_id"]}).status_code, 400)
        self.assertNotIn("fml_session", self.client.cookies)

    def test_google_invalid_signature_and_wrong_authorized_party_rejected(self):
        flow = self.client.post("/auth/google/start").json()
        with patch("app.auth_api.id_token.verify_oauth2_token", side_effect=ValueError("bad signature")):
            result = self.client.post("/auth/google", json={"challenge_id": flow["challenge_id"], "credential": "bad-token"})
        self.assertEqual(result.status_code, 401)
        result, _, _ = self.google(azp="another-client")
        self.assertEqual(result.status_code, 401)
        self.assertNotIn("fml_session", self.client.cookies)

    def test_daily_request_quota_is_persistent_across_new_flows(self):
        self.signup()
        self.change(EmailDeliveryQuota, digest("recipient:" + self.email), count=settings.email_max_per_hour,
            last_sent_at=now() - timedelta(seconds=61))
        self.assertEqual(self.signup(username="another_user").status_code, 429)

    def test_cleanup_removes_only_stale_auth_artifacts(self):
        from app.auth_cleanup import cleanup
        first = self.signup().json()
        self.change(AuthChallenge, uuid.UUID(first["challenge_id"]), expires_at=now() - timedelta(days=2))
        self.change(EmailDeliveryQuota, digest("recipient:" + self.email), last_sent_at=now() - timedelta(days=2))
        self.email = "fresh-" + self.email
        fresh = self.signup().json()
        with Session(bind=self.connection, join_transaction_mode="create_savepoint") as session:
            removed = cleanup(session)
        self.assertGreaterEqual(removed["expired_challenges_removed"], 1)
        self.assertIsNone(self.query(AuthChallenge, id=uuid.UUID(first["challenge_id"])))
        self.assertIsNotNone(self.query(AuthChallenge, id=uuid.UUID(fresh["challenge_id"])))

    def test_google_rejects_expired_challenge_and_browser_swap(self):
        flow = self.client.post("/auth/google/start").json()
        with TestClient(app) as other:
            result = other.post("/auth/google", json={"challenge_id": flow["challenge_id"], "credential": "token"})
            self.assertEqual(result.status_code, 400)
        self.change(AuthChallenge, uuid.UUID(flow["challenge_id"]), expires_at=now() - timedelta(seconds=1))
        result = self.client.post("/auth/google", json={"challenge_id": flow["challenge_id"], "credential": "token"})
        self.assertEqual(result.status_code, 400)


class EmailTransportTests(unittest.TestCase):
    def test_smtp_transport_is_reusable_and_uses_tls(self):
        with patch.object(settings, "smtp_host", "smtp.example.com"), patch.object(settings, "smtp_from_email", "hello@example.com"), patch.object(settings, "smtp_security", "starttls"), patch.object(settings, "smtp_username", "sender"), patch.object(settings, "smtp_password", "test-only-password"), patch("app.email_service.smtplib.SMTP") as smtp:
            SMTPEmailSender().send(OutboundEmail("receiver@example.com", "Future notification", "Reusable text", "<p>Reusable HTML</p>"))
            connection = smtp.return_value.__enter__.return_value
            connection.starttls.assert_called_once()
            connection.login.assert_called_once()
            connection.send_message.assert_called_once()


if __name__ == "__main__":
    unittest.main()
