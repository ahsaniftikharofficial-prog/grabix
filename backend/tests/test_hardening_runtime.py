import unittest
from pathlib import Path
import sys
from unittest import mock

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient

import main


class HardeningRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_sensitive_settings_route_rejects_missing_desktop_auth_when_enforced(self):
        with mock.patch("app.services.desktop_auth.is_desktop_auth_required", return_value=True), \
             mock.patch("app.services.desktop_auth.is_desktop_auth_observe_only", return_value=False), \
             mock.patch("app.services.desktop_auth.desktop_auth_token", return_value="desktop-secret"):
            response = self.client.post("/settings", json={"theme": "dark"})

        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertEqual(payload["detail"]["code"], "desktop_auth_missing")
        self.assertEqual(payload["detail"]["service"], "security")

    def test_sensitive_settings_route_accepts_valid_desktop_auth_when_enforced(self):
        with mock.patch("app.services.desktop_auth.is_desktop_auth_required", return_value=True), \
             mock.patch("app.services.desktop_auth.is_desktop_auth_observe_only", return_value=False), \
             mock.patch("app.services.desktop_auth.desktop_auth_token", return_value="desktop-secret"):
            response = self.client.post(
                "/settings",
                json={"theme": "light"},
                headers={"X-Grabix-Desktop-Auth": "desktop-secret"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("theme", payload)

    def test_read_only_settings_route_stays_open(self):
        with mock.patch("app.services.desktop_auth.is_desktop_auth_required", return_value=True), \
             mock.patch("app.services.desktop_auth.is_desktop_auth_observe_only", return_value=False), \
             mock.patch("app.services.desktop_auth.desktop_auth_token", return_value="desktop-secret"):
            response = self.client.get("/settings")

        self.assertEqual(response.status_code, 200)

    def test_metadata_tmdb_search_routes_through_backend_service(self):
        payload = {"results": [{"id": 42, "name": "Test Show"}]}
        with mock.patch("app.services.tmdb.fetch_tmdb_json", new=mock.AsyncMock(return_value=payload)):
            response = self.client.get("/metadata/tmdb/search?media_type=tv&query=test&page=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["id"], 42)

    def test_metadata_tmdb_missing_config_returns_structured_error(self):
        with mock.patch("app.services.tmdb.has_tmdb_token", return_value=False):
            response = self.client.get("/metadata/tmdb/search?media_type=tv&query=test&page=1")

        self.assertEqual(response.status_code, 503)
        payload = response.json()
        self.assertEqual(payload["detail"]["code"], "tmdb_config_missing")
        self.assertEqual(payload["detail"]["service"], "tmdb")

    def test_string_http_errors_are_normalized(self):
        response = self.client.get("/consumet/proxy", params={"url": "https://example.com/file.mp4"})

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIsInstance(payload.get("detail"), dict)
        self.assertIn("approved media allowlist", payload["detail"]["message"])
        self.assertEqual(payload["detail"]["service"], "consumet")


if __name__ == "__main__":
    unittest.main()
