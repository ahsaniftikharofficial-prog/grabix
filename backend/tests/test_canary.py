"""
GRABIX CANARY TESTS
===================
These are the smoke alarm tests. Run them after EVERY change.
If any test fails, something broke. Do NOT merge until all pass.

Run with:
    cd backend
    python -m pytest tests/test_canary.py -v

What these tests cover (the things that break most often):
  1.  App starts and responds at all
  2.  Health ping
  3.  Downloads list (empty OK)
  4.  Settings read
  5.  FFmpeg status
  6.  Cache stats
  7.  Providers status
  8.  Diagnostics logs
  9.  Check-link with a real URL
  10. Circuit breaker status
"""

import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient
import main


class CanaryTests(unittest.TestCase):
    """
    One client for all 10 tests — fast, no repeated startup cost.
    These tests only check: does the route respond without crashing?
    They do NOT require real streaming, real downloads, or internet.
    """

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app, raise_server_exceptions=True)

    # ── CANARY 1 ──────────────────────────────────────────────────────────
    def test_01_app_root_responds(self):
        """The app itself is alive."""
        response = self.client.get("/")
        self.assertIn(response.status_code, [200, 404],
                      "App root should respond (200 or 404), not crash")

    # ── CANARY 2 ──────────────────────────────────────────────────────────
    def test_02_health_ping(self):
        """Health ping always returns ok=True when backend is ready."""
        response = self.client.get("/health/ping")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get("ok"), f"Health ping returned ok=False: {payload}")
        self.assertTrue(payload.get("core_ready"), f"core_ready is False: {payload}")

    # ── CANARY 3 ──────────────────────────────────────────────────────────
    def test_03_downloads_list(self):
        """Downloads list endpoint responds (empty list is fine)."""
        response = self.client.get("/downloads")
        self.assertEqual(response.status_code, 200,
                         f"GET /downloads crashed: {response.text}")
        payload = response.json()
        # Should be a list (possibly empty)
        self.assertIsInstance(payload, list,
                              f"Expected a list from /downloads, got: {type(payload)}")

    # ── CANARY 4 ──────────────────────────────────────────────────────────
    def test_04_settings_read(self):
        """Settings endpoint returns a dict without crashing."""
        response = self.client.get("/settings")
        self.assertEqual(response.status_code, 200,
                         f"GET /settings crashed: {response.text}")
        payload = response.json()
        self.assertIsInstance(payload, dict,
                              f"Expected a dict from /settings, got: {type(payload)}")

    # ── CANARY 5 ──────────────────────────────────────────────────────────
    def test_05_ffmpeg_status(self):
        """FFmpeg status endpoint responds and reports found/not found cleanly."""
        response = self.client.get("/ffmpeg-status")
        self.assertEqual(response.status_code, 200,
                         f"GET /ffmpeg-status crashed: {response.text}")
        payload = response.json()
        # Must have an "available" key — True or False is both OK
        self.assertIn("available", payload,
                      f"ffmpeg-status response missing 'available' key: {payload}")

    # ── CANARY 6 ──────────────────────────────────────────────────────────
    def test_06_cache_stats(self):
        """Cache stats endpoint responds with a dict."""
        response = self.client.get("/cache/stats")
        self.assertEqual(response.status_code, 200,
                         f"GET /cache/stats crashed: {response.text}")
        payload = response.json()
        self.assertIsInstance(payload, dict,
                              f"Expected a dict from /cache/stats, got: {type(payload)}")

    # ── CANARY 7 ──────────────────────────────────────────────────────────
    def test_07_providers_status(self):
        """Providers status endpoint responds without crashing."""
        response = self.client.get("/providers/status")
        self.assertIn(response.status_code, [200, 503],
                      f"GET /providers/status crashed: {response.text}")
        payload = response.json()
        self.assertIsInstance(payload, dict,
                              f"Expected a dict from /providers/status, got: {type(payload)}")

    # ── CANARY 8 ──────────────────────────────────────────────────────────
    def test_08_diagnostics_logs(self):
        """Diagnostics logs endpoint responds with log structure."""
        response = self.client.get("/diagnostics/logs?limit=5")
        self.assertEqual(response.status_code, 200,
                         f"GET /diagnostics/logs crashed: {response.text}")
        payload = response.json()
        self.assertIn("events", payload,
                      f"Diagnostics logs missing 'events' key: {payload}")
        self.assertIsInstance(payload["events"], list,
                              f"Expected 'events' to be a list: {payload}")

    # ── CANARY 9 ──────────────────────────────────────────────────────────
    def test_09_check_link_with_valid_url(self):
        """Check-link route handles a real public URL without crashing."""
        import urllib.parse
        test_url = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        encoded = urllib.parse.quote(test_url, safe="")
        response = self.client.get(f"/check-link?url={encoded}")
        # Could be 200 (OK) or 400 (blocked) — should NOT be 500
        self.assertNotEqual(response.status_code, 500,
                            f"check-link crashed with 500: {response.text}")
        self.assertNotEqual(response.status_code, 422,
                            f"check-link returned 422 Unprocessable: {response.text}")

    # ── CANARY 10 ─────────────────────────────────────────────────────────
    def test_10_circuit_breaker_status(self):
        """Circuit breaker status endpoint responds with a dict."""
        response = self.client.get("/health/circuit-breaker/status")
        self.assertEqual(response.status_code, 200,
                         f"GET /health/circuit-breaker/status crashed: {response.text}")
        payload = response.json()
        self.assertIsInstance(payload, dict,
                              f"Expected a dict from circuit-breaker/status, got: {type(payload)}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
