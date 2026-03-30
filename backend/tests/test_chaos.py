import unittest
from unittest.mock import AsyncMock, patch
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient

import main


class ChaosFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_health_capabilities_degrades_when_consumet_health_fails(self):
        with patch("main.get_consumet_health_status", new=AsyncMock(side_effect=RuntimeError("boom"))):
            main.consumet_health_cache = None
            response = self.client.get("/health/capabilities")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["summary"]["backend_reachable"])
        self.assertEqual(payload["services"]["consumet"]["status"], "degraded")
        self.assertTrue(payload["capabilities"]["can_play_anime_fallback"])


if __name__ == "__main__":
    unittest.main()
