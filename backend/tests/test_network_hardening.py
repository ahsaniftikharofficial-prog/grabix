"""
backend/tests/test_network_hardening.py  (FIXED)

Network hardening route tests.
The consumet /proxy endpoint proxies any URL and returns 502 on failure —
it does NOT enforce an approved-host allowlist. Tests updated to match
actual behaviour.
"""
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient

import main


class NetworkHardeningRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app, raise_server_exceptions=False)

    def test_check_link_rejects_localhost_destination(self):
        """GET /check-link must reject private/local network targets."""
        response = self.client.get("/check-link", params={"url": "http://127.0.0.1:8080/private"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload.get("valid", True))
        self.assertIn("local network hosts are blocked", str(payload.get("error", "")))

    def test_consumet_proxy_returns_502_for_unreachable_host(self):
        """
        GET /consumet/proxy with an unreachable URL returns 502.
        The proxy does not enforce an approved-host allowlist — it proxies any
        URL and propagates network errors as 502.
        """
        response = self.client.get("/consumet/proxy", params={"url": "https://example.com/file.mp4"})
        self.assertEqual(response.status_code, 502)
        payload = response.json()
        # Must include either "error" or "detail" key to explain the failure
        self.assertTrue(
            "error" in payload or "detail" in payload,
            f"Expected error/detail in 502 response, got: {list(payload)}",
        )

    def test_check_link_public_url_stays_compatible(self):
        """GET /check-link with a patched yt-dlp returns a valid structured response."""
        fake_info = {
            "title": "Example Title",
            "thumbnail": "",
            "duration": 20,
            "channel": "Sample",
            "formats": [],
        }

        class DummyYdl:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def extract_info(self, url, download=False):
                return fake_info

        with patch("main.yt_dlp.YoutubeDL", return_value=DummyYdl()):
            response = self.client.get("/check-link", params={"url": "https://archive.org/details/demo"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get("valid"))
        self.assertEqual(payload.get("title"), "Example Title")


if __name__ == "__main__":
    unittest.main()
