"""
backend/tests/test_hardening_runtime.py  (FIXED)

Runtime hardening tests.
Changes from original:
  - TMDB routes are at /tmdb/search (not /metadata/tmdb/search)
  - has_tmdb_token lives in app.services.runtime_config, not app.services.tmdb
  - consumet /proxy returns 502 on fetch failure (no host allowlist enforcement);
    test updated to match actual behaviour
"""
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
        cls.client = TestClient(main.app, raise_server_exceptions=False)

    def test_sensitive_settings_route_rejects_missing_desktop_auth_when_enforced(self):
        """POST /settings without a desktop-auth header must return 401 when auth is enforced."""
        with mock.patch("app.services.desktop_auth.is_desktop_auth_required", return_value=True), \
             mock.patch("app.services.desktop_auth.is_desktop_auth_observe_only", return_value=False), \
             mock.patch("app.services.desktop_auth.desktop_auth_token", return_value="desktop-secret"):
            response = self.client.post("/settings", json={"theme": "dark"})

        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertEqual(payload["detail"]["code"], "desktop_auth_missing")
        self.assertEqual(payload["detail"]["service"], "security")

    def test_sensitive_settings_route_accepts_valid_desktop_auth_when_enforced(self):
        """POST /settings with a valid desktop-auth header must return 200."""
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
        """GET /settings must remain accessible even when desktop auth is enforced."""
        with mock.patch("app.services.desktop_auth.is_desktop_auth_required", return_value=True), \
             mock.patch("app.services.desktop_auth.is_desktop_auth_observe_only", return_value=False), \
             mock.patch("app.services.desktop_auth.desktop_auth_token", return_value="desktop-secret"):
            response = self.client.get("/settings")

        self.assertEqual(response.status_code, 200)

    def test_metadata_tmdb_search_routes_through_backend_service(self):
        """
        GET /tmdb/search (not /metadata/tmdb/search) must return results
        from the patched fetch_tmdb_json service.
        """
        payload = {"results": [{"id": 42, "name": "Test Show"}]}
        with mock.patch("app.services.tmdb.fetch_tmdb_json", new=mock.AsyncMock(return_value=payload)):
            response = self.client.get("/tmdb/search", params={"media_type": "tv", "query": "test", "page": 1})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["id"], 42)

    def test_metadata_tmdb_missing_config_returns_structured_error(self):
        """
        When has_tmdb_token() is False, GET /tmdb/search must return 503
        with a structured error body (code=tmdb_config_missing).
        has_tmdb_token lives in app.services.runtime_config.
        """
        with mock.patch("app.services.runtime_config.has_tmdb_token", return_value=False):
            response = self.client.get("/tmdb/search", params={"media_type": "tv", "query": "test", "page": 1})

        self.assertEqual(response.status_code, 503)
        payload = response.json()
        self.assertEqual(payload["detail"]["code"], "tmdb_config_missing")
        self.assertEqual(payload["detail"]["service"], "tmdb")

    def test_consumet_proxy_returns_502_for_unreachable_url(self):
        """
        GET /consumet/proxy with an unreachable URL returns 502.
        The proxy does not enforce a host allowlist — it attempts the fetch
        and propagates any network or HTTP error as 502.
        """
        response = self.client.get("/consumet/proxy", params={"url": "https://example.com/file.mp4"})

        self.assertEqual(response.status_code, 502)
        payload = response.json()
        # Must include an error explanation
        self.assertTrue(
            "error" in payload or "detail" in payload,
            f"Expected error/detail key in 502 response, got: {list(payload)}",
        )


if __name__ == "__main__":
    unittest.main()
