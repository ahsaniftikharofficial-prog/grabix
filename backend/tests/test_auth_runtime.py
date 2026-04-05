import unittest
from pathlib import Path
import sys
from unittest import mock

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient

import main


class AuthRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_auth_status_reports_configuration_state(self):
        with mock.patch("app.services.supabase_auth.is_supabase_auth_configured", return_value=False):
            response = self.client.get("/auth/status")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["provider"], "supabase")
        self.assertFalse(payload["configured"])

    def test_auth_me_requires_bearer_session(self):
        response = self.client.get("/auth/me")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertEqual(payload["detail"]["code"], "cloud_auth_missing")

    def test_auth_me_returns_verified_user(self):
        with mock.patch(
            "app.routes.auth.require_supabase_user",
            new=mock.AsyncMock(
                return_value={
                    "id": "user-123",
                    "email": "demo@example.com",
                    "role": "authenticated",
                    "app_metadata": {"provider": "email"},
                    "user_metadata": {"name": "Demo"},
                }
            ),
        ):
            response = self.client.get("/auth/me", headers={"Authorization": "Bearer token-123"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["user"]["id"], "user-123")
        self.assertEqual(payload["user"]["email"], "demo@example.com")
