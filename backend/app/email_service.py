"""Reusable transport and message templates. Callers own delivery authorization."""
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from html import escape
import smtplib
import ssl

from app.config import settings


class EmailDeliveryError(Exception):
    pass


@dataclass(frozen=True)
class OutboundEmail:
    recipient: str
    subject: str
    text: str
    html: str | None = None


class SMTPEmailSender:
    """Shared by verification, future password resets, and notifications."""

    def send(self, message: OutboundEmail) -> None:
        if not settings.email_ready:
            raise EmailDeliveryError("Email delivery is not configured.")
        if settings.is_production and settings.smtp_security == "plain":
            raise EmailDeliveryError("Production email requires TLS.")
        mail = EmailMessage()
        mail["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
        mail["To"] = message.recipient
        mail["Subject"] = message.subject
        mail.set_content(message.text)
        if message.html:
            mail.add_alternative(message.html, subtype="html")
        try:
            context = ssl.create_default_context()
            if settings.smtp_security == "ssl":
                connection = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10, context=context)
            else:
                connection = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
            with connection as smtp:
                if settings.smtp_security == "starttls":
                    smtp.starttls(context=context)
                if settings.smtp_username:
                    smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(mail)
        except (OSError, smtplib.SMTPException) as exc:
            # Do not expose provider errors, credentials, recipients, or OTPs.
            raise EmailDeliveryError("Email delivery failed.") from exc


email_sender = SMTPEmailSender()


def verification_email(recipient: str, code: str, purpose: str) -> OutboundEmail:
    title = "Verify your email" if purpose in {"signup", "google_signup"} else "Confirm your sign-in"
    minutes = max(1, settings.email_otp_ttl_seconds // 60)
    text = f"{title}\n\nYour FMLCore code is {code}. It expires in {minutes} minutes.\n\nIf you didn't request this, ignore this email. Never share this code."
    html = f"<h1>{title}</h1><p>Your FMLCore code:</p><p style='font-size:32px;letter-spacing:6px;font-weight:bold'>{escape(code)}</p><p>Expires in {minutes} minutes. If you didn't request this, ignore this email. Never share this code.</p>"
    return OutboundEmail(recipient, f"{title} — FMLCore", text, html)
