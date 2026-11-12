"""Remove only expired authentication artifacts; safe to run as maintenance."""
from datetime import timedelta

from sqlalchemy import delete

from app.db import SessionLocal
from app.email_verification import now
from app.models import AuthChallenge, EmailDeliveryQuota


def cleanup(db):
    cutoff = now() - timedelta(days=1)
    challenges = db.execute(delete(AuthChallenge).where(AuthChallenge.expires_at < cutoff)).rowcount
    quotas = db.execute(delete(EmailDeliveryQuota).where(EmailDeliveryQuota.last_sent_at < cutoff)).rowcount
    db.commit()
    return {"expired_challenges_removed": challenges, "stale_quotas_removed": quotas}


if __name__ == "__main__":
    with SessionLocal() as session:
        print(cleanup(session))
