import unittest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from app.config import settings
from app.worker_control import get_worker_status, start_worker, stop_worker


class WorkerControlTests(unittest.TestCase):
    def test_managed_worker_is_detected_through_database_not_api_processes(self):
        for running in (True, False):
            db = MagicMock()
            db.scalar.side_effect = [running, 2, 1, 0, 3]
            with patch.object(settings, "same_sky_worker_managed", True), patch("app.worker_control.SessionLocal") as sessions, patch("app.worker_control.subprocess.check_output") as pgrep:
                sessions.return_value.__enter__.return_value = db
                status = get_worker_status()
            self.assertEqual(status["running"], running)
            self.assertTrue(status["managed_externally"])
            self.assertEqual(status["queued_jobs"], 2)
            pgrep.assert_not_called()
            self.assertIn("pg_stat_activity", str(db.scalar.call_args_list[0].args[0]))

    def test_missing_local_process_tool_does_not_crash_overview(self):
        db = MagicMock()
        db.scalar.return_value = 0
        with patch.object(settings, "same_sky_worker_managed", False), patch("app.worker_control.SessionLocal") as sessions, patch("app.worker_control.subprocess.check_output", side_effect=FileNotFoundError):
            sessions.return_value.__enter__.return_value = db
            self.assertFalse(get_worker_status()["running"])

    def test_managed_worker_controls_cannot_spawn_or_kill_api_container_processes(self):
        with patch.object(settings, "same_sky_worker_managed", True), patch("app.worker_control.subprocess.Popen") as spawn, patch("app.worker_control.os.kill") as kill:
            for action in (start_worker, stop_worker):
                with self.assertRaises(HTTPException) as error:
                    action()
                self.assertEqual(error.exception.status_code, 409)
            spawn.assert_not_called()
            kill.assert_not_called()
