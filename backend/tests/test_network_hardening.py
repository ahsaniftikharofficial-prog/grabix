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
        cls.client = TestClient(main.app)

    def test_check_link_rejects_localhost_destination(self):
        response = self.client.get("/check-link", params={"url": "http://127.0.0.1:8080/private"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload.get("valid", True))
        self.assertIn("local network hosts are blocked", str(payload.get("error", "")))

    def test_consumet_proxy_rejects_unapproved_host(self):
        response = self.client.get("/consumet/proxy", params={"url": "https://example.com/file.mp4"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("approved media allowlist", str(response.json().get("detail", "")))

    def test_check_link_public_url_stays_compatible(self):
        fake_info = {"title": "Example Title", "thumbnail": "", "duration": 20, "channel": "Sample", "formats": []}

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
