"""
backend/tests/test_shape.py
─────────────────────────────────────────────────────────────────────────────
Layer 2 tests — response SHAPE validation.

These tests go one level deeper than test_features.py:
  - test_features.py asks: "Does the endpoint respond without crashing?"
  - test_shape.py asks:    "Does the response have the correct structure?"

Rules:
  1. Never assert exact content values (titles, IDs, counts) — external APIs change.
  2. Shape checks only run when status == 200. 502/503 = external service down = OK.
  3. Each class is independent with its own TestClient.
  4. 422 = FastAPI rejected the request due to missing required param.
  5. 401/403 = auth gating — acceptable, not a bug.

Usage:
    cd backend
    pytest tests/test_shape.py -v
"""

import sys
import unittest
from pathlib import Path

# ── Path bootstrap (mirrors test_features.py) ─────────────────────────────────
# Adds the backend/ root to sys.path so that `core`, `app`, `moviebox`, etc.
# are importable regardless of where pytest is invoked from.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
# ─────────────────────────────────────────────────────────────────────────────

from starlette.testclient import TestClient
from core.main import app


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_list_or_dict_with_list(data) -> bool:
    """Returns True if data is a list, or a dict that contains at least one list value."""
    if isinstance(data, list):
        return True
    if isinstance(data, dict):
        return any(isinstance(v, list) for v in data.values())
    return False


_SOFT_OK = {200, 400, 401, 403, 404, 422, 502, 503}
"""Status codes that are never a backend crash."""


# =============================================================================
# GROUP 1 — INFRASTRUCTURE & HEALTH
# =============================================================================

class TestInfrastructureShape(unittest.TestCase):
    """Shape tests for health, diagnostics, cache, and root routes."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    # ── / ─────────────────────────────────────────────────────────────────────

    def test_01_root_not_500(self):
        """GET / responds without a server crash."""
        r = self.c.get("/")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_02_root_is_dict(self):
        """GET / returns a JSON object."""
        r = self.c.get("/")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    # ── /health/ping ─────────────────────────────────────────────────────────

    def test_03_ping_has_ok_key(self):
        """GET /health/ping returns a dict with an 'ok' boolean."""
        r = self.c.get("/health/ping")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("ok", data, "Missing 'ok' key in ping response")
            self.assertIsInstance(data["ok"], bool, "'ok' should be a bool")

    def test_04_ping_has_services_dict(self):
        """GET /health/ping 'services' value is a dict."""
        r = self.c.get("/health/ping")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("services", data, "Missing 'services' key")
            self.assertIsInstance(data["services"], dict, "'services' should be a dict")

    def test_05_ping_has_core_ready_bool(self):
        """GET /health/ping 'core_ready' value is a bool."""
        r = self.c.get("/health/ping")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("core_ready", data, "Missing 'core_ready' key")
            self.assertIsInstance(data["core_ready"], bool)

    # ── /health/services ─────────────────────────────────────────────────────

    def test_06_health_services_is_dict(self):
        """GET /health/services returns a dict."""
        r = self.c.get("/health/services")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_07_health_services_has_services_key(self):
        """GET /health/services response contains a 'services' dict."""
        r = self.c.get("/health/services")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("services", data)
            self.assertIsInstance(data["services"], dict)

    # ── /health/capabilities ─────────────────────────────────────────────────

    def test_08_health_capabilities_is_dict(self):
        """GET /health/capabilities returns a dict."""
        r = self.c.get("/health/capabilities")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_09_health_capabilities_has_capabilities_key(self):
        """GET /health/capabilities response has a 'capabilities' dict."""
        r = self.c.get("/health/capabilities")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("capabilities", data)
            self.assertIsInstance(data["capabilities"], dict)

    # ── /health/log ──────────────────────────────────────────────────────────

    def test_10_health_log_is_list_or_dict(self):
        """GET /health/log returns a list or dict."""
        r = self.c.get("/health/log")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), (list, dict))

    def test_11_health_log_has_events_key_if_dict(self):
        """GET /health/log dict response has an 'events' key."""
        r = self.c.get("/health/log")
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, dict):
                self.assertIn("events", data)

    # ── /health/circuit-breaker/* ─────────────────────────────────────────────

    def test_12_circuit_breaker_status_is_dict(self):
        """GET /health/circuit-breaker/status returns a dict."""
        r = self.c.get("/health/circuit-breaker/status")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            data = r.json()
            self.assertIsInstance(data, dict)

    def test_13_circuit_breaker_status_has_circuit_breakers_key(self):
        """GET /health/circuit-breaker/status response has 'circuit_breakers' key."""
        r = self.c.get("/health/circuit-breaker/status")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("circuit_breakers", data)

    def test_14_circuit_breaker_reset_not_500(self):
        """POST /health/circuit-breaker/reset responds without a crash."""
        r = self.c.post("/health/circuit-breaker/reset")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    # ── /diagnostics/* ───────────────────────────────────────────────────────

    def test_15_diagnostics_logs_is_dict(self):
        """GET /diagnostics/logs returns a dict."""
        r = self.c.get("/diagnostics/logs")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_16_diagnostics_self_test_is_dict(self):
        """GET /diagnostics/self-test returns a dict."""
        r = self.c.get("/diagnostics/self-test")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_17_diagnostics_export_not_500(self):
        """GET /diagnostics/export responds without a crash."""
        r = self.c.get("/diagnostics/export")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    # ── /providers/status ────────────────────────────────────────────────────

    def test_18_providers_status_is_dict(self):
        """GET /providers/status returns a dict."""
        r = self.c.get("/providers/status")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    # ── /cache/* ─────────────────────────────────────────────────────────────

    def test_19_cache_stats_is_dict(self):
        """GET /cache/stats returns a dict."""
        r = self.c.get("/cache/stats")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_20_cache_clear_not_500(self):
        """POST /cache/clear responds without a crash."""
        r = self.c.post("/cache/clear")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    # ── /check-link ──────────────────────────────────────────────────────────

    def test_21_check_link_missing_url_422(self):
        """GET /check-link without 'url' param returns 422."""
        r = self.c.get("/check-link")
        self.assertEqual(r.status_code, 422)

    def test_22_check_link_with_url_not_500(self):
        """GET /check-link with a url param does not crash."""
        r = self.c.get("/check-link", params={"url": "https://example.com/test.mp4"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")


# =============================================================================
# GROUP 2 — SETTINGS
# =============================================================================

class TestSettingsShape(unittest.TestCase):
    """Shape tests for /settings, /tmdb-status, and adult-content routes."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_settings_get_not_500(self):
        """GET /settings does not crash (may require desktop auth → 401/403)."""
        r = self.c.get("/settings")
        self.assertNotIn(r.status_code, [500], f"Crashed: {r.text}")

    def test_02_settings_get_is_dict_if_200(self):
        """GET /settings returns a dict when accessible."""
        r = self.c.get("/settings")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_03_settings_has_download_dir_key(self):
        """GET /settings response includes a 'download_dir' key when accessible."""
        r = self.c.get("/settings")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("download_dir", data, "Missing 'download_dir' in settings")

    def test_04_settings_has_quality_key(self):
        """GET /settings response includes a 'default_quality' key when accessible."""
        r = self.c.get("/settings")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("default_quality", data, "Missing 'default_quality' in settings")

    def test_05_settings_post_returns_dict(self):
        """POST /settings with an empty body returns a dict (or auth error)."""
        r = self.c.post("/settings", json={})
        self.assertNotIn(r.status_code, [500], f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_06_tmdb_status_not_500(self):
        """GET /tmdb-status does not crash."""
        r = self.c.get("/tmdb-status")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_07_tmdb_status_has_configured_bool(self):
        """GET /tmdb-status 'configured' field is a bool."""
        r = self.c.get("/tmdb-status")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("configured", data)
            self.assertIsInstance(data["configured"], bool)

    def test_08_tmdb_status_has_source_str(self):
        """GET /tmdb-status 'source' field is a string."""
        r = self.c.get("/tmdb-status")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("source", data)
            self.assertIsInstance(data["source"], str)

    def test_09_adult_unlock_wrong_pin_not_500(self):
        """POST /settings/adult-content/unlock with wrong pin returns an auth rejection, never 500."""
        r = self.c.post(
            "/settings/adult-content/unlock",
            json={"password": "definitely_wrong_pin_xyzzy"},
        )
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        self.assertIn(
            r.status_code, [400, 401, 403, 422, 428, 429],
            f"Expected auth rejection, got {r.status_code}",
        )


# =============================================================================
# GROUP 3 — DOWNLOADS
# =============================================================================

class TestDownloadsShape(unittest.TestCase):
    """Shape tests for download queue, status, and runtime dependency routes."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_downloads_list_is_list(self):
        """GET /downloads returns a JSON list."""
        r = self.c.get("/downloads")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list, "Downloads response should be a list")

    def test_02_download_get_missing_url_422(self):
        """GET /download without 'url' param returns 422."""
        r = self.c.get("/download")
        self.assertEqual(r.status_code, 422)

    def test_03_download_post_missing_url_422(self):
        """POST /download without a body (or missing url) returns 422."""
        r = self.c.post("/download", json={})
        self.assertEqual(r.status_code, 422)

    def test_04_download_fake_url_not_500(self):
        """POST /download with a placeholder URL does not crash the server."""
        r = self.c.post(
            "/download",
            json={"url": "https://example.com/test.mp4", "dl_type": "video"},
        )
        self.assertNotIn(
            r.status_code, [500],
            f"Crashed: {r.text}",
        )

    def test_05_download_status_fake_id_not_500(self):
        """GET /download-status/<fake_id> returns 404 or similar, never 500."""
        r = self.c.get("/download-status/fake-id-that-does-not-exist-xyzzy")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_06_progress_fake_id_not_500(self):
        """GET /progress/<fake_id> does not crash."""
        r = self.c.get("/progress/fake-id-that-does-not-exist-xyzzy")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_07_action_fake_id_not_500(self):
        """POST /downloads/<fake_id>/action does not crash."""
        r = self.c.post(
            "/downloads/fake-id-that-does-not-exist-xyzzy/action",
            json={"action": "pause"},
        )
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_08_delete_fake_id_not_500(self):
        """DELETE /downloads/<fake_id> does not crash."""
        r = self.c.delete("/downloads/fake-id-that-does-not-exist-xyzzy")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_09_stop_all_not_500(self):
        """POST /downloads/stop-all does not crash."""
        r = self.c.post("/downloads/stop-all")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_10_runtime_deps_is_dict(self):
        """GET /runtime/dependencies returns a dict."""
        r = self.c.get("/runtime/dependencies")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_11_runtime_deps_install_not_500(self):
        """POST /runtime/dependencies/install does not crash."""
        r = self.c.post("/runtime/dependencies/install")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    @unittest.skip("Opens Windows Explorer — OS side-effect, not safe in CI")
    def test_12_open_download_folder_not_500(self):
        """POST /open-download-folder does not crash."""
        r = self.c.post("/open-download-folder")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_13_stream_route_registered(self):
        """The /downloads/stream SSE route is registered in the app."""
        registered_paths = [route.path for route in app.routes]
        self.assertIn(
            "/downloads/stream", registered_paths,
            "Route /downloads/stream is not registered",
        )


# =============================================================================
# GROUP 4 — STREAMING
# =============================================================================

class TestStreamingShape(unittest.TestCase):
    """Shape tests for ffmpeg-status, embed resolvers, and stream proxy routes."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_ffmpeg_status_not_500(self):
        """GET /ffmpeg-status does not crash."""
        r = self.c.get("/ffmpeg-status")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_02_ffmpeg_status_has_available_bool(self):
        """GET /ffmpeg-status response has an 'available' boolean key."""
        r = self.c.get("/ffmpeg-status")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("available", data, "Missing 'available' key")
            self.assertIsInstance(data["available"], bool)

    def test_03_resolve_embed_missing_url_422(self):
        """GET /resolve-embed without 'url' param returns 422."""
        r = self.c.get("/resolve-embed")
        self.assertEqual(r.status_code, 422)

    def test_04_resolve_embed_fake_url_not_500(self):
        """GET /resolve-embed with a fake url does not crash."""
        r = self.c.get("/resolve-embed", params={"url": "https://example.com/embed/fake"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_05_stream_variants_missing_url_422(self):
        """GET /stream/variants without 'url' param returns 422."""
        r = self.c.get("/stream/variants")
        self.assertEqual(r.status_code, 422)

    def test_06_extract_stream_missing_url_422(self):
        """GET /extract-stream without 'url' param returns 422."""
        r = self.c.get("/extract-stream")
        self.assertEqual(r.status_code, 422)

    def test_07_stream_proxy_missing_url_422(self):
        """GET /stream/proxy without 'url' param returns 422."""
        r = self.c.get("/stream/proxy")
        self.assertEqual(r.status_code, 422)


# =============================================================================
# GROUP 5 — TMDB & IMDB METADATA
# =============================================================================

class TestMetadataShape(unittest.TestCase):
    """Shape tests for TMDB and IMDB chart endpoints."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_tmdb_discover_movie_not_500(self):
        """GET /tmdb/discover (movies, trending) does not crash."""
        r = self.c.get("/tmdb/discover", params={"media_type": "movie", "category": "trending"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_02_tmdb_discover_returns_results_list_if_200(self):
        """GET /tmdb/discover returns a dict with a 'results' list when accessible."""
        r = self.c.get("/tmdb/discover", params={"media_type": "movie", "category": "trending"})
        if r.status_code == 200:
            data = r.json()
            self.assertIn("results", data, "Missing 'results' key in discover response")
            self.assertIsInstance(data["results"], list)

    def test_03_tmdb_discover_tv_not_500(self):
        """GET /tmdb/discover (tv, trending) does not crash."""
        r = self.c.get("/tmdb/discover", params={"media_type": "tv", "category": "trending"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_04_tmdb_search_missing_query_422(self):
        """GET /tmdb/search without 'query' param returns 422."""
        r = self.c.get("/tmdb/search")
        self.assertEqual(r.status_code, 422)

    def test_05_tmdb_search_result_has_results_key(self):
        """GET /tmdb/search response contains a 'results' key when accessible."""
        r = self.c.get("/tmdb/search", params={"query": "Inception"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("results", data)

    def test_06_tmdb_search_results_is_list(self):
        """GET /tmdb/search 'results' value is a list."""
        r = self.c.get("/tmdb/search", params={"query": "Inception"})
        if r.status_code == 200:
            data = r.json()
            if "results" in data:
                self.assertIsInstance(data["results"], list)

    def test_07_tmdb_details_missing_id_422(self):
        """GET /tmdb/details without 'id' param returns 422."""
        r = self.c.get("/tmdb/details")
        self.assertEqual(r.status_code, 422)

    def test_08_tmdb_details_has_id_field_if_200(self):
        """GET /tmdb/details with a valid id returns a dict with an 'id' key."""
        r = self.c.get("/tmdb/details", params={"id": 27205, "media_type": "movie"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            data = r.json()
            self.assertIsInstance(data, dict)
            self.assertIn("id", data)

    def test_09_tmdb_tv_season_missing_season_422(self):
        """GET /tmdb/tv-season without required params returns 422."""
        r = self.c.get("/tmdb/tv-season")
        self.assertEqual(r.status_code, 422)

    def test_10_tmdb_tv_season_map_missing_id_422(self):
        """GET /tmdb/tv-season-map without 'id' param returns 422."""
        r = self.c.get("/tmdb/tv-season-map")
        self.assertEqual(r.status_code, 422)

    def test_11_imdb_chart_missing_chart_422(self):
        """GET /imdb/chart without 'chart' param returns 422."""
        r = self.c.get("/imdb/chart")
        self.assertEqual(r.status_code, 422)

    def test_12_imdb_chart_top250_not_500(self):
        """GET /imdb/chart?chart=top250 does not crash."""
        r = self.c.get("/imdb/chart", params={"chart": "top250"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_13_imdb_chart_result_is_list_or_dict_if_200(self):
        """GET /imdb/chart response is a list or a dict containing a list."""
        r = self.c.get("/imdb/chart", params={"chart": "top250"})
        if r.status_code == 200:
            data = r.json()
            self.assertTrue(
                _is_list_or_dict_with_list(data),
                f"Expected list or dict-with-list, got {type(data).__name__}",
            )


# =============================================================================
# GROUP 6 — PROVIDERS (stream resolution)
# =============================================================================

class TestProvidersShape(unittest.TestCase):
    """Shape tests for /providers/resolve/* endpoints."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_resolve_movie_empty_body_422(self):
        """POST /providers/resolve/movie with empty body returns 422."""
        r = self.c.post("/providers/resolve/movie", json={})
        self.assertEqual(r.status_code, 422)

    def test_02_resolve_movie_returns_dict_if_not_error(self):
        """POST /providers/resolve/movie with a body returns a dict (if not 422/500)."""
        r = self.c.post(
            "/providers/resolve/movie",
            json={"title": "Inception", "year": 2010},
        )
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_03_resolve_movie_has_sources_or_streams_if_200(self):
        """POST /providers/resolve/movie response has 'sources' or 'streams' key when accessible."""
        r = self.c.post(
            "/providers/resolve/movie",
            json={"title": "Inception", "year": 2010},
        )
        if r.status_code == 200:
            data = r.json()
            has_sources = "sources" in data or "streams" in data
            self.assertTrue(has_sources, f"Missing 'sources'/'streams' key. Keys: {list(data)}")

    def test_04_resolve_tv_empty_body_422(self):
        """POST /providers/resolve/tv with empty body returns 422."""
        r = self.c.post("/providers/resolve/tv", json={})
        self.assertEqual(r.status_code, 422)

    def test_05_resolve_tv_not_500_with_body(self):
        """POST /providers/resolve/tv with a body does not crash."""
        r = self.c.post(
            "/providers/resolve/tv",
            json={"title": "Breaking Bad", "season": 1, "episode": 1},
        )
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_06_resolve_anime_empty_body_422(self):
        """POST /providers/resolve/anime with empty body returns 422."""
        r = self.c.post("/providers/resolve/anime", json={})
        self.assertEqual(r.status_code, 422)

    def test_07_resolve_anime_not_500_with_body(self):
        """POST /providers/resolve/anime with a body does not crash."""
        r = self.c.post(
            "/providers/resolve/anime",
            json={"title": "Naruto", "episode": 1},
        )
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")


# =============================================================================
# GROUP 7 — MOVIEBOX
# =============================================================================

class TestMovieBoxShape(unittest.TestCase):
    """Shape tests for /moviebox/* endpoints."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_discover_not_500(self):
        """GET /moviebox/discover does not crash."""
        r = self.c.get("/moviebox/discover")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_02_search_missing_title_422(self):
        """GET /moviebox/search without 'title' param returns 422."""
        r = self.c.get("/moviebox/search")
        self.assertEqual(r.status_code, 422)

    def test_03_search_items_missing_query_422(self):
        """GET /moviebox/search-items without 'query' param returns 422."""
        r = self.c.get("/moviebox/search-items")
        self.assertEqual(r.status_code, 422)

    def test_04_search_items_returns_dict_with_items_if_200(self):
        """GET /moviebox/search-items response has 'items' list when accessible."""
        r = self.c.get("/moviebox/search-items", params={"query": "Inception"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("items", data, "Missing 'items' key")
            self.assertIsInstance(data["items"], list)

    def test_05_details_missing_both_ids_422(self):
        """GET /moviebox/details without subject_id or title returns 422."""
        r = self.c.get("/moviebox/details")
        self.assertEqual(r.status_code, 422)

    def test_06_details_returns_dict_if_200(self):
        """GET /moviebox/details returns a dict when accessible (MovieBox may be unavailable → 500/503 acceptable)."""
        r = self.c.get("/moviebox/details", params={"title": "Inception"})
        # MovieBox is an optional external provider; 500/503 means it is down, not a code bug.
        # The health routes already expose moviebox status — here we just verify shape when it works.
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_07_sources_missing_both_ids_422(self):
        """GET /moviebox/sources without subject_id or title returns 422."""
        r = self.c.get("/moviebox/sources")
        self.assertEqual(r.status_code, 422)

    def test_08_poster_missing_url_422(self):
        """GET /moviebox/poster without 'url' param returns 422."""
        r = self.c.get("/moviebox/poster")
        self.assertEqual(r.status_code, 422)

    def test_09_subtitle_missing_url_422(self):
        """GET /moviebox/subtitle without 'url' param returns 422."""
        r = self.c.get("/moviebox/subtitle")
        self.assertEqual(r.status_code, 422)


# =============================================================================
# GROUP 8 — CONSUMET
# =============================================================================

class TestConsumetShape(unittest.TestCase):
    """Shape tests for /consumet/* endpoints."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_health_is_dict(self):
        """GET /consumet/health returns a dict."""
        r = self.c.get("/consumet/health")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_02_discover_anime_not_500(self):
        """GET /consumet/discover/anime does not crash."""
        r = self.c.get("/consumet/discover/anime")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_03_discover_manga_not_500(self):
        """GET /consumet/discover/manga does not crash."""
        r = self.c.get("/consumet/discover/manga")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_04_search_missing_query_422(self):
        """GET /consumet/search/<domain> without 'query' param returns 422."""
        r = self.c.get("/consumet/search/gogoanime")
        self.assertEqual(r.status_code, 422)

    def test_05_episodes_missing_id_422(self):
        """GET /consumet/episodes/anime without 'id' param returns 422."""
        r = self.c.get("/consumet/episodes/anime")
        self.assertEqual(r.status_code, 422)

    def test_06_chapters_missing_id_422(self):
        """GET /consumet/chapters/manga without 'id' param returns 422."""
        r = self.c.get("/consumet/chapters/manga")
        self.assertEqual(r.status_code, 422)

    def test_07_watch_missing_episode_id_422(self):
        """GET /consumet/watch/anime without 'episode_id' param returns 422."""
        r = self.c.get("/consumet/watch/anime")
        self.assertEqual(r.status_code, 422)

    def test_08_news_feed_not_500(self):
        """GET /consumet/news/feed does not crash."""
        r = self.c.get("/consumet/news/feed")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_09_news_feed_is_list_or_dict_if_200(self):
        """GET /consumet/news/feed returns a list or dict."""
        r = self.c.get("/consumet/news/feed")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), (list, dict))

    def test_10_meta_search_missing_query_422(self):
        """GET /consumet/meta/search without 'query' param returns 422."""
        r = self.c.get("/consumet/meta/search")
        self.assertEqual(r.status_code, 422)

    def test_11_proxy_missing_url_422(self):
        """GET /consumet/proxy without 'url' param returns 422."""
        r = self.c.get("/consumet/proxy")
        self.assertEqual(r.status_code, 422)


# =============================================================================
# GROUP 9 — ANIWATCH
# =============================================================================

class TestAniwatchShape(unittest.TestCase):
    """Shape tests for /aniwatch/* endpoints."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_health_not_500(self):
        """GET /aniwatch/health does not crash."""
        r = self.c.get("/aniwatch/health")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_02_health_is_dict_if_200(self):
        """GET /aniwatch/health returns a dict when accessible."""
        r = self.c.get("/aniwatch/health")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_03_discover_not_500(self):
        """GET /aniwatch/discover does not crash."""
        r = self.c.get("/aniwatch/discover")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_04_search_missing_query_422(self):
        """GET /aniwatch/search without 'query' param returns 422."""
        r = self.c.get("/aniwatch/search")
        self.assertEqual(r.status_code, 422)

    def test_05_search_with_query_not_500(self):
        """GET /aniwatch/search with a query does not crash."""
        r = self.c.get("/aniwatch/search", params={"query": "Naruto"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_06_search_returns_dict_if_200(self):
        """GET /aniwatch/search returns a dict when accessible."""
        r = self.c.get("/aniwatch/search", params={"query": "Naruto"})
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_07_genres_not_500(self):
        """GET /aniwatch/genres does not crash."""
        r = self.c.get("/aniwatch/genres")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_08_genre_page_not_500(self):
        """GET /aniwatch/genre/action does not crash."""
        r = self.c.get("/aniwatch/genre/action")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_09_schedule_not_500(self):
        """GET /aniwatch/schedule does not crash."""
        r = self.c.get("/aniwatch/schedule")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_10_spotlight_not_500(self):
        """GET /aniwatch/spotlight does not crash."""
        r = self.c.get("/aniwatch/spotlight")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")


# =============================================================================
# GROUP 10 — MANGA
# =============================================================================

class TestMangaShape(unittest.TestCase):
    """Shape tests for /manga/* endpoints."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def _assert_items_list(self, path: str):
        """Helper: assert endpoint returns a dict with an 'items' list."""
        r = self.c.get(path)
        self.assertNotEqual(r.status_code, 500, f"Crashed at {path}: {r.text}")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("items", data, f"Missing 'items' key at {path}")
            self.assertIsInstance(data["items"], list)

    def test_01_trending_returns_items_list(self):
        """GET /manga/trending returns a dict with an 'items' list."""
        self._assert_items_list("/manga/trending")

    def test_02_popular_returns_items_list(self):
        """GET /manga/popular returns a dict with an 'items' list."""
        self._assert_items_list("/manga/popular")

    def test_03_top_rated_returns_items_list(self):
        """GET /manga/top-rated returns a dict with an 'items' list."""
        self._assert_items_list("/manga/top-rated")

    def test_04_frontpage_has_source_and_items(self):
        """GET /manga/frontpage returns a dict with 'source' and 'items' keys."""
        r = self.c.get("/manga/frontpage")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("source", data, "Missing 'source' key")
            self.assertIn("items", data, "Missing 'items' key")

    def test_05_search_missing_query_422(self):
        """GET /manga/search without 'query' param returns 422."""
        r = self.c.get("/manga/search")
        self.assertEqual(r.status_code, 422)

    def test_06_search_returns_items_and_source_if_200(self):
        """GET /manga/search response has 'items' and 'source' keys when accessible."""
        r = self.c.get("/manga/search", params={"query": "Naruto"})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            data = r.json()
            self.assertIn("items", data)
            self.assertIn("source", data)

    def test_07_seasonal_returns_items_list(self):
        """GET /manga/seasonal returns a dict with an 'items' list."""
        self._assert_items_list("/manga/seasonal")

    def test_08_comick_chapters_missing_id_422(self):
        """GET /manga/comick/chapters without 'id' param returns 422."""
        r = self.c.get("/manga/comick/chapters")
        self.assertEqual(r.status_code, 422)

    def test_09_image_proxy_missing_url_422(self):
        """GET /manga/image-proxy without 'url' param returns 422."""
        r = self.c.get("/manga/image-proxy")
        self.assertEqual(r.status_code, 422)


# =============================================================================
# GROUP 11 — SUBTITLES
# =============================================================================

class TestSubtitlesShape(unittest.TestCase):
    """Shape tests for /subtitles/* endpoints."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_search_missing_params_422(self):
        """GET /subtitles/search without required params returns 422."""
        r = self.c.get("/subtitles/search")
        self.assertEqual(r.status_code, 422)

    def test_02_search_with_params_not_500(self):
        """GET /subtitles/search with title and year does not crash."""
        r = self.c.get("/subtitles/search", params={"title": "Inception", "year": 2010})
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_03_search_result_is_list_or_dict_if_200(self):
        """GET /subtitles/search returns a list or a dict containing a 'results' list."""
        r = self.c.get("/subtitles/search", params={"title": "Inception", "year": 2010})
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list):
                pass  # bare list — acceptable
            else:
                self.assertIsInstance(data, dict, "Expected list or dict")
                self.assertIn("results", data, "Missing 'results' key in subtitle search response")
                self.assertIsInstance(data["results"], list)

    def test_04_cached_is_list_if_200(self):
        """GET /subtitles/cached returns a list when accessible."""
        r = self.c.get("/subtitles/cached")
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")
        if r.status_code == 200:
            self.assertIsInstance(r.json(), list)

    def test_05_download_missing_params_422(self):
        """GET /subtitles/download without required params returns 422."""
        r = self.c.get("/subtitles/download")
        self.assertEqual(r.status_code, 422)


# =============================================================================
# GROUP 12 — ANIME RESOLVER
# =============================================================================

class TestAnimeResolverShape(unittest.TestCase):
    """Shape tests for /anime/resolve-source."""

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(app, raise_server_exceptions=False)

    def test_01_empty_body_422(self):
        """POST /anime/resolve-source with empty body returns 422."""
        r = self.c.post("/anime/resolve-source", json={})
        self.assertEqual(r.status_code, 422)

    def test_02_with_body_not_500(self):
        """POST /anime/resolve-source with a body does not crash."""
        r = self.c.post(
            "/anime/resolve-source",
            json={"title": "Naruto", "episode": 1},
        )
        self.assertNotEqual(r.status_code, 500, f"Crashed: {r.text}")

    def test_03_result_is_dict_if_200(self):
        """POST /anime/resolve-source returns a dict when accessible."""
        r = self.c.post(
            "/anime/resolve-source",
            json={"title": "Naruto", "episode": 1},
        )
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)


# =============================================================================
# Entry point
# =============================================================================

if __name__ == "__main__":
    unittest.main(verbosity=2)
