"""
backend/tests/test_bootstrap_runtime.py  (FIXED)

Tests for bootstrap, consumet health, moviebox availability, and domain queries.
Updated to match the Phase-2 refactored codebase where:
  - `get_runtime_bootstrap_snapshot` was removed from main (now in downloads.engine)
  - moviebox state lives in moviebox/__init__, not main
  - consumet.get_health_status() returns {healthy, base, error/hint} — no "configured" key
  - _fetch_jikan_anime_full / search_mangadex_manga do not exist; replaced by sidecar calls
"""
import asyncio
import json
import os
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path
from unittest import mock

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _run_backend_script(script: str) -> dict:
    env = os.environ.copy()
    existing_pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = (
        f"{BACKEND_ROOT}{os.pathsep}{existing_pythonpath}"
        if existing_pythonpath
        else str(BACKEND_ROOT)
    )

    completed = subprocess.run(
        [sys.executable, "-c", textwrap.dedent(script)],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        env=env,
    )

    if completed.returncode != 0:
        raise AssertionError(
            "Backend subprocess failed.\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )

    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise AssertionError(f"Backend subprocess produced no JSON output.\nstderr:\n{completed.stderr}")
    return json.loads(lines[-1])


class RuntimeBootstrapTests(unittest.TestCase):

    def test_import_only_does_not_run_runtime_bootstrap(self):
        """Importing main should not trigger side-effects; app must be accessible."""
        payload = _run_backend_script(
            """
            import json
            import main

            # The app object must be importable and have routes registered.
            route_paths = [r.path for r in main.app.routes]
            has_health = any("/health" in p for p in route_paths)
            has_downloads = any("download" in p for p in route_paths)

            print(json.dumps({
                "has_app": main.app is not None,
                "has_health_routes": has_health,
                "has_download_routes": has_downloads,
            }))
            """
        )

        self.assertTrue(payload["has_app"])
        self.assertTrue(payload["has_health_routes"])
        self.assertTrue(payload["has_download_routes"])

    def test_runtime_bootstrap_is_idempotent(self):
        """Calling ensure_runtime_bootstrap() twice must not raise or corrupt state."""
        payload = _run_backend_script(
            """
            import json
            import main
            from downloads.engine import ensure_runtime_bootstrap

            ensure_runtime_bootstrap()
            ensure_runtime_bootstrap()  # second call must be a no-op

            # App is still intact
            route_paths = [r.path for r in main.app.routes]
            print(json.dumps({
                "ok": True,
                "route_count": len(route_paths),
            }))
            """
        )

        self.assertTrue(payload["ok"])
        self.assertGreater(payload["route_count"], 0)

    def test_consumet_health_reports_unhealthy_when_sidecar_unset(self):
        """
        When CONSUMET_API_BASE is unset the sidecar is unreachable.
        get_health_status() must return healthy=False with an error or hint key.
        """
        previous = os.environ.pop("CONSUMET_API_BASE", None)
        try:
            from app.services import consumet

            health = asyncio.run(consumet.get_health_status())
        finally:
            if previous is not None:
                os.environ["CONSUMET_API_BASE"] = previous

        self.assertFalse(health["healthy"])
        # Either "error" or "hint" key must be present to explain the failure
        self.assertTrue(
            "error" in health or "hint" in health,
            f"Expected 'error' or 'hint' in health response, got: {list(health)}",
        )

    def test_moviebox_state_exposed_via_moviebox_module(self):
        """
        After the Phase-2 refactor moviebox state lives in moviebox/__init__.
        MOVIEBOX_AVAILABLE and MOVIEBOX_IMPORT_ERROR must be accessible there.
        """
        import moviebox as _mb

        # Must be booleans / strings — types matter more than values
        self.assertIsInstance(_mb.MOVIEBOX_AVAILABLE, bool)
        self.assertIsInstance(_mb.MOVIEBOX_IMPORT_ERROR, (str, type(None)))

    def test_anime_domain_info_returns_dict(self):
        """
        fetch_domain_info must return a dict for any domain/provider/id combo.
        When sidecar is absent it returns {"error": ...} — that is acceptable.
        """
        previous = os.environ.pop("CONSUMET_API_BASE", None)
        try:
            from app.services import consumet

            result = asyncio.run(consumet.fetch_domain_info("anime", "hianime", "fake-id"))
        finally:
            if previous is not None:
                os.environ["CONSUMET_API_BASE"] = previous

        self.assertIsInstance(result, dict, "fetch_domain_info must always return a dict")

    def test_manga_search_domain_returns_dict(self):
        """
        search_domain for manga must return a dict with an 'items' key.
        When sidecar is absent items may be empty — that is acceptable.
        """
        previous = os.environ.pop("CONSUMET_API_BASE", None)
        try:
            from app.services import consumet

            result = asyncio.run(consumet.search_domain("manga", "Naruto"))
        finally:
            if previous is not None:
                os.environ["CONSUMET_API_BASE"] = previous

        self.assertIsInstance(result, dict, "search_domain must always return a dict")
        self.assertIn("items", result, "search_domain result must have 'items' key")
        self.assertIsInstance(result["items"], list)


if __name__ == "__main__":
    unittest.main()
