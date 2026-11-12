"""Process management and on-demand batch execution for the Same Sky worker."""

import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from sqlalchemy import func, select, text
from fastapi import HTTPException
from app.config import settings
from app.db import SessionLocal
from app.models import SameSkyJob


def get_worker_status() -> dict:
    pids = []
    running = False
    if not settings.same_sky_worker_managed:
        try:
            out = subprocess.check_output(["pgrep", "-f", r"app\.same_sky_worker"]).decode().strip()
            pids = [int(p) for p in out.splitlines() if int(p) != os.getpid()]
            running = bool(pids)
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass

    with SessionLocal() as db:
        if settings.same_sky_worker_managed:
            # Container PIDs are isolated. The dedicated LISTEN connection is
            # visible across containers and disappears when its worker exits.
            running = bool(db.scalar(text("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database()
                    AND application_name = 'fmlcore-same-sky-worker'
                )
            """)))
        now = datetime.now(timezone.utc)
        queued_count = db.scalar(
            select(func.count(SameSkyJob.id)).where(SameSkyJob.status == "queued")
        ) or 0
        processing_count = db.scalar(
            select(func.count(SameSkyJob.id)).where(SameSkyJob.status == "processing")
        ) or 0
        failed_count = db.scalar(
            select(func.count(SameSkyJob.id)).where(SameSkyJob.status == "failed")
        ) or 0
        complete_count = db.scalar(
            select(func.count(SameSkyJob.id)).where(SameSkyJob.status == "complete")
        ) or 0

    return {
        "running": running,
        "pids": pids,
        "managed_externally": settings.same_sky_worker_managed,
        "queued_jobs": queued_count,
        "processing_jobs": processing_count,
        "failed_jobs": failed_count,
        "completed_jobs": complete_count,
    }


def start_worker() -> dict:
    if settings.same_sky_worker_managed:
        raise HTTPException(status_code=409, detail="This worker is managed by the server. Use Docker Compose to start or stop it.")
    status = get_worker_status()
    if status["running"]:
        return {"ok": True, "action": "already_running", "pids": status["pids"]}

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    proc = subprocess.Popen(
        [sys.executable, "-m", "app.same_sky_worker"],
        cwd=backend_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    time.sleep(0.5)
    new_status = get_worker_status()
    return {"ok": True, "action": "started", "pids": new_status["pids"]}


def stop_worker() -> dict:
    if settings.same_sky_worker_managed:
        raise HTTPException(status_code=409, detail="This worker is managed by the server. Use Docker Compose to start or stop it.")
    status = get_worker_status()
    if not status["running"]:
        return {"ok": True, "action": "already_stopped", "pids": []}

    for pid in status["pids"]:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    time.sleep(0.5)
    refreshed = get_worker_status()
    if refreshed["running"]:
        for pid in refreshed["pids"]:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        time.sleep(0.3)

    final_status = get_worker_status()
    return {"ok": True, "action": "stopped", "pids": final_status["pids"]}


def process_batch(max_jobs: int = 50) -> dict:
    from app.same_sky_matching import process_one_job

    processed = 0
    while processed < max_jobs and process_one_job():
        processed += 1

    final_status = get_worker_status()
    return {
        "ok": True,
        "processed_count": processed,
        "remaining_queued": final_status["queued_jobs"],
    }
