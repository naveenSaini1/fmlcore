"""Explicitly queue a Same Sky reanalysis after changing model settings."""

import argparse

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import SameSkyAnalysis, SameSkyEmbedding, SameSkyJob, SameSkyProfile
from app.same_sky_common import enqueue_job, invalidate_matches, update_eligibility


def main() -> None:
    parser = argparse.ArgumentParser(description="Reprocess Same Sky posts with the configured models.")
    parser.add_argument("--apply", action="store_true", help="Delete old derived data and queue fresh analysis. Without this flag, only show the number of posts affected.")
    args = parser.parse_args()
    with SessionLocal() as db:
        analyses = db.scalars(select(SameSkyAnalysis)).all()
        print(f"Posts to reprocess: {len(analyses)}")
        if not args.apply:
            print("Dry run only. Add --apply after reviewing expected provider costs.")
            return
        user_ids = {analysis.user_id for analysis in analyses}
        for analysis in analyses:
            db.execute(delete(SameSkyEmbedding).where(SameSkyEmbedding.post_id == analysis.post_id))
            db.execute(delete(SameSkyJob).where(
                SameSkyJob.job_type == "analyze_post",
                SameSkyJob.payload["post_id"].as_string() == str(analysis.post_id),
                SameSkyJob.status == "queued",
            ))
            analysis.processing_status = "pending"
            analysis.processing_error = None
            analysis.themes = []
            analysis.experience_context = ""
            analysis.safe_summary = ""
            analysis.emotional_context = ""
            analysis.copy_signal = "low"
            analysis.safety_flags = []
            analysis.model_name = ""
            enqueue_job(db, "analyze_post", {"post_id": str(analysis.post_id)})
        for user_id in user_ids:
            profile = db.scalar(select(SameSkyProfile).where(SameSkyProfile.user_id == user_id).with_for_update())
            if profile:
                update_eligibility(db, profile)
                invalidate_matches(db, user_id)
        db.commit()
        print("Reanalysis jobs queued. Monitor the same-sky-worker logs.")


if __name__ == "__main__":
    main()
