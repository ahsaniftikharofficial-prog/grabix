"""
backend/tests/test_chaos.py  (FIXED)

Chaos / fallback tests.
After the Phase-2 split, consumet health logic lives in core.health — not main.
Patch target updated accordingly.
Also patched: core.health.consumet_health_cache so the cached value is cleared
before each test.
"""
import unittest
from unittest.mock import AsyncMock, patch
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient

import main
import core.health as _health_mod


class ChaosFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app, raise_server_exceptions=False)

    def test_health_capabilities_degrades_when_consumet_health_fails(self):
        """
        When the consumet sidecar throws, /health/capabilities must still return 200
        with consumet marked degraded and anime fallback still available.
        """
        # Clear the module-level health cache so the mock is actually called.
        _health_mod.consumet_health_cache = None

        with patch(
            "core.health.get_consumet_health_status",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            response = self.client.get("/health/capabilities")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["summary"]["backend_reachable"])
        self.assertIn(
            payload["services"]["consumet"]["status"],
            {"degraded", "offline"},
            "Consumet must be degraded or offline when health check throws",
        )
        self.assertTrue(payload["capabilities"]["can_play_anime_fallback"])


if __name__ == "__main__":
    unittest.main()
