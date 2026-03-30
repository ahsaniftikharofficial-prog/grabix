import logging
import unittest
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient

import main
from app.services.logging_utils import get_logger, log_event


class RuntimeHealthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_health_ping_reports_core_backend_ready(self):
        response = self.client.get("/health/ping")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertIn("backend", payload["services"])
        self.assertIn("database", payload["services"])
        self.assertIn("downloads", payload["services"])

    def test_diagnostics_logs_exposes_recent_events(self):
        logger = get_logger("backend")
        log_event(
            logger,
            logging.WARNING,
            event="test_runtime_warning",
            message="Runtime diagnostics warning test event.",
            correlation_id="test-runtime-correlation",
            details={"source": "unit-test"},
        )
        response = self.client.get("/diagnostics/logs?limit=10")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("backend_log_path", payload)
        self.assertIn("events", payload)
        self.assertTrue(
            any(event.get("event") == "test_runtime_warning" for event in payload["events"]),
            "Expected the recent diagnostics log feed to include the injected test event.",
        )


if __name__ == "__main__":
    unittest.main()
