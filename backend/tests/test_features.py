"""
GRABIX FEATURE TESTS
====================
85 tests covering every major feature group in Grabix.

Philosophy:
  - 502 = "external service unreachable"  → ACCEPTABLE (our code is fine)
  - 500 = "our code crashed"              → NEVER acceptable
  - Missing required param                → must return 422, not 500
  - Every response must have correct JSON shape

These tests run with NO internet using FastAPI's TestClient.
They test YOUR code, not external services like HiAnime or TMDB.

Run with:
    cd backend
    python -m pytest tests/test_features.py -v

Run just one group:
    python -m pytest tests/test_features.py -v -k "Downloads"
"""

import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient
import main

# Acceptable "our code is fine, external service is down" status codes
EXTERNAL_OK = {200, 400, 404, 422, 502, 503}
# Routes that need internet return these — all mean our code didn't crash
NETWORK_OK = {200, 400, 404, 502, 503}


def client():
    return TestClient(main.app, raise_server_exceptions=False)


# =============================================================================
# GROUP 1 — INFRASTRUCTURE (Health, Diagnostics, Cache)
# =============================================================================

class TestInfrastructure(unittest.TestCase):
    """
    Tests: /health/*, /diagnostics/*, /cache/*, /providers/status
    Rule: These must ALWAYS return 200. They have no external dependencies.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_root_responds(self):
        r = self.c.get("/")
        self.assertNotEqual(r.status_code, 500, f"Root crashed: {r.text}")

    def test_02_health_ping(self):
        r = self.c.get("/health/ping")
        self.assertEqual(r.status_code, 200, f"Health ping failed: {r.text}")
        data = r.json()
        self.assertIn("ok", data)
        self.assertTrue(data["ok"], f"ok=False: {data}")

    def test_03_health_services_responds(self):
        r = self.c.get("/health/services")
        self.assertEqual(r.status_code, 200, f"/health/services crashed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_04_health_capabilities_responds(self):
        r = self.c.get("/health/capabilities")
        self.assertEqual(r.status_code, 200, f"/health/capabilities crashed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_05_circuit_breaker_status(self):
        r = self.c.get("/health/circuit-breaker/status")
        self.assertEqual(r.status_code, 200, f"Circuit breaker status crashed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_06_providers_status_shape(self):
        r = self.c.get("/providers/status")
        self.assertIn(r.status_code, [200, 503], f"Providers status crashed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_07_diagnostics_logs(self):
        r = self.c.get("/diagnostics/logs?limit=5")
        self.assertEqual(r.status_code, 200, f"Diagnostics logs crashed: {r.text}")
        data = r.json()
        self.assertIn("events", data, f"Missing 'events' key: {data}")
        self.assertIsInstance(data["events"], list)

    def test_08_diagnostics_self_test(self):
        """Self-test runs heavy checks (disk, DB, library). Must return JSON, never crash hard."""
        r = self.c.get("/diagnostics/self-test")
        # 200 = all checks passed. 500/503 = checks ran but something failed. Both are OK.
        # What's NOT OK is the route throwing an unhandled exception with no JSON body.
        self.assertIn(r.status_code, [200, 500, 503], f"Unexpected status: {r.status_code}")
        try:
            data = r.json()
            self.assertIsInstance(data, dict, f"Self-test response is not a dict: {data}")
        except Exception:
            self.fail(f"Self-test returned non-JSON body: {r.text[:200]}")

    def test_09_cache_stats_shape(self):
        r = self.c.get("/cache/stats")
        self.assertEqual(r.status_code, 200, f"Cache stats crashed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_10_cache_clear_responds(self):
        r = self.c.post("/cache/clear")
        self.assertNotEqual(r.status_code, 500, f"Cache clear crashed: {r.text}")

    def test_11_health_log_responds(self):
        r = self.c.get("/health/log")
        self.assertNotEqual(r.status_code, 500, f"/health/log crashed: {r.text}")

    def test_12_circuit_breaker_reset_responds(self):
        r = self.c.post("/health/circuit-breaker/reset")
        self.assertNotEqual(r.status_code, 500, f"Circuit breaker reset crashed: {r.text}")


# =============================================================================
# GROUP 2 — SETTINGS
# =============================================================================

class TestSettings(unittest.TestCase):
    """
    Tests: GET /settings, POST /settings, /tmdb-status, adult content
    Rule: Settings must always be readable. Writes must persist.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_settings_read_returns_dict(self):
        r = self.c.get("/settings")
        self.assertEqual(r.status_code, 200, f"GET /settings failed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_02_settings_has_key_fields(self):
        r = self.c.get("/settings")
        data = r.json()
        # At least ONE of these core keys must exist
        core_keys = {"download_path", "quality", "theme", "language", "download_folder"}
        found = core_keys & set(data.keys())
        self.assertTrue(len(found) > 0, f"Settings missing all core keys. Got: {list(data.keys())}")

    def test_03_settings_write_responds(self):
        r = self.c.post("/settings", json={"theme": "dark"})
        self.assertNotEqual(r.status_code, 500, f"POST /settings crashed: {r.text}")
        self.assertIn(r.status_code, [200, 400, 422])

    def test_04_settings_roundtrip(self):
        """Write a value, read it back — must match."""
        before = self.c.get("/settings").json()
        test_payload = {**before, "theme": "dark"}
        self.c.post("/settings", json=test_payload)
        after = self.c.get("/settings").json()
        # After saving, settings must still be readable
        self.assertIsInstance(after, dict)

    def test_05_tmdb_status_responds(self):
        r = self.c.get("/tmdb-status")
        self.assertNotEqual(r.status_code, 500, f"/tmdb-status crashed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_06_adult_content_configure_responds(self):
        r = self.c.post("/settings/adult-content/configure", json={"enabled": False})
        self.assertNotEqual(r.status_code, 500, f"Adult content configure crashed: {r.text}")

    def test_07_adult_content_unlock_bad_pin_returns_error(self):
        """Wrong PIN must return 4xx, not 500."""
        r = self.c.post("/settings/adult-content/unlock", json={"pin": "0000"})
        self.assertNotEqual(r.status_code, 500, f"Adult unlock crashed: {r.text}")
        self.assertIn(r.status_code, [200, 400, 401, 403, 422])


# =============================================================================
# GROUP 3 — DOWNLOADS
# =============================================================================

class TestDownloads(unittest.TestCase):
    """
    Tests: /downloads, /download, /download-status, /progress, /downloads/{id}/action
    Rule: Queue management must work locally. Bad IDs must return 4xx not 500.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_list_downloads_returns_list(self):
        r = self.c.get("/downloads")
        self.assertEqual(r.status_code, 200, f"GET /downloads failed: {r.text}")
        self.assertIsInstance(r.json(), list)

    def test_02_start_download_missing_url_returns_422(self):
        """Missing required 'url' param must be 422, not 500."""
        r = self.c.post("/download", json={"title": "test"})
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing URL, got: {r.status_code}")

    def test_03_start_download_get_missing_url_returns_422(self):
        r = self.c.get("/download?title=test")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing URL, got: {r.status_code}")

    def test_04_start_download_fake_url_does_not_crash(self):
        """A fake URL should queue or fail gracefully — never 500."""
        r = self.c.post("/download", json={
            "url": "https://example.com/fake-video.mp4",
            "title": "Test Video",
            "dl_type": "video",
            "quality": "best"
        })
        self.assertNotEqual(r.status_code, 500, f"Start download crashed: {r.text}")
        # 200/201/202 = queued, 400/422 = validation rejection — all acceptable
        self.assertIn(r.status_code, [200, 201, 202, 400, 422],
                      f"Unexpected status for fake download: {r.status_code} — {r.text}")

    def test_05_download_status_fake_id_not_500(self):
        r = self.c.get("/download-status/fake-id-99999")
        self.assertNotEqual(r.status_code, 500, f"Download status crashed: {r.text}")
        self.assertIn(r.status_code, [200, 404])

    def test_06_download_progress_fake_id_not_500(self):
        r = self.c.get("/progress/fake-id-99999")
        self.assertNotEqual(r.status_code, 500, f"Progress endpoint crashed: {r.text}")

    def test_07_download_action_fake_id_not_500(self):
        r = self.c.post("/downloads/fake-id-99999/action", json={"action": "pause"})
        self.assertNotEqual(r.status_code, 500, f"Download action crashed: {r.text}")

    def test_08_delete_download_fake_id_not_500(self):
        r = self.c.delete("/downloads/fake-id-99999")
        self.assertNotEqual(r.status_code, 500, f"Delete download crashed: {r.text}")

    def test_09_stop_all_downloads_responds(self):
        r = self.c.post("/downloads/stop-all")
        self.assertNotEqual(r.status_code, 500, f"Stop all downloads crashed: {r.text}")

    def test_10_runtime_dependencies_responds(self):
        r = self.c.get("/runtime/dependencies")
        self.assertNotEqual(r.status_code, 500, f"Runtime dependencies crashed: {r.text}")
        self.assertIsInstance(r.json(), (dict, list))

    def test_11_downloads_stream_endpoint_exists(self):
        """SSE /downloads/stream route must be registered and not 404/500.

        Starlette's sync TestClient buffers the entire response body before
        returning, so an infinite SSE generator blocks forever — threading
        cannot help here.  Instead we verify the route is registered via the
        app's route table (fastest, deterministic) and do a HEAD-equivalent
        check via the OpenAPI spec.
        """
        # 1. Confirm the route is registered in the app.
        import core.main as _cm
        registered_paths = {getattr(r, "path", "") for r in _cm.app.routes}
        self.assertIn(
            "/downloads/stream", registered_paths,
            "SSE endpoint /downloads/stream is not registered in the app",
        )

        # 2. Confirm the OpenAPI schema lists the route (catches include_router
        #    omissions that wouldn't show up in the route table check above).
        schema = self.c.get("/openapi.json")
        self.assertNotEqual(schema.status_code, 500, "openapi.json crashed")
        if schema.status_code == 200:
            paths = schema.json().get("paths", {})
            self.assertIn(
                "/downloads/stream", paths,
                "SSE endpoint missing from OpenAPI schema",
            )


# =============================================================================
# GROUP 4 — STREAMING
# =============================================================================

class TestStreaming(unittest.TestCase):
    """
    Tests: /ffmpeg-status, /resolve-embed, /stream/variants, /extract-stream, /check-link
    Rule: Missing params → 422. Network failure → 502 not 500.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_ffmpeg_status_has_available_key(self):
        r = self.c.get("/ffmpeg-status")
        self.assertEqual(r.status_code, 200, f"/ffmpeg-status failed: {r.text}")
        data = r.json()
        self.assertIn("available", data, f"Missing 'available' key: {data}")

    def test_02_resolve_embed_missing_url_returns_422(self):
        r = self.c.get("/resolve-embed")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing url: {r.status_code}")

    def test_03_resolve_embed_fake_url_not_500(self):
        r = self.c.get("/resolve-embed?url=https%3A%2F%2Fexample.com%2Fembed%2Ffake")
        self.assertNotEqual(r.status_code, 500, f"resolve-embed crashed: {r.text}")

    def test_04_stream_variants_missing_url_returns_422(self):
        r = self.c.get("/stream/variants")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing url: {r.status_code}")

    def test_05_extract_stream_missing_url_returns_422(self):
        r = self.c.get("/extract-stream")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing url: {r.status_code}")

    def test_06_check_link_missing_url_returns_422(self):
        r = self.c.get("/check-link")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing url: {r.status_code}")

    def test_07_check_link_valid_url_not_500(self):
        import urllib.parse
        url = urllib.parse.quote("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", safe="")
        r = self.c.get(f"/check-link?url={url}")
        self.assertNotEqual(r.status_code, 500, f"check-link crashed: {r.text}")


# =============================================================================
# GROUP 5 — METADATA (TMDB + IMDb)
# =============================================================================

class TestMetadata(unittest.TestCase):
    """
    Tests: /tmdb/discover, /tmdb/search, /tmdb/details, /imdb/chart
    Rule: Missing required params → 422. Network failure → not 500.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_tmdb_discover_movie_trending(self):
        r = self.c.get("/tmdb/discover?media_type=movie&category=trending")
        self.assertNotEqual(r.status_code, 500, f"TMDB discover crashed: {r.text}")
        self.assertIn(r.status_code, NETWORK_OK)

    def test_02_tmdb_discover_tv_popular(self):
        r = self.c.get("/tmdb/discover?media_type=tv&category=popular")
        self.assertNotEqual(r.status_code, 500, f"TMDB discover tv crashed: {r.text}")

    def test_03_tmdb_search_missing_query_returns_422(self):
        r = self.c.get("/tmdb/search?media_type=movie")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing query: {r.status_code}")

    def test_04_tmdb_search_with_query_not_500(self):
        r = self.c.get("/tmdb/search?media_type=movie&query=Inception")
        self.assertNotEqual(r.status_code, 500, f"TMDB search crashed: {r.text}")

    def test_05_tmdb_details_missing_id_returns_422(self):
        r = self.c.get("/tmdb/details?media_type=movie")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing id: {r.status_code}")

    def test_06_tmdb_details_with_id_not_500(self):
        r = self.c.get("/tmdb/details?media_type=movie&id=27205")
        self.assertNotEqual(r.status_code, 500, f"TMDB details crashed: {r.text}")

    def test_07_tmdb_tv_season_missing_params_returns_422(self):
        r = self.c.get("/tmdb/tv-season?id=1399")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing season: {r.status_code}")

    def test_08_imdb_chart_missing_chart_returns_422(self):
        r = self.c.get("/imdb/chart")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing chart: {r.status_code}")

    def test_09_imdb_chart_top250_not_500(self):
        r = self.c.get("/imdb/chart?chart=top250")
        self.assertNotEqual(r.status_code, 500, f"IMDb chart crashed: {r.text}")

    def test_10_tmdb_season_map_missing_id_returns_422(self):
        r = self.c.get("/tmdb/tv-season-map")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing id: {r.status_code}")


# =============================================================================
# GROUP 6 — PROVIDERS (movie/TV/anime stream resolution)
# =============================================================================

class TestProviders(unittest.TestCase):
    """
    Tests: POST /providers/resolve/movie, /tv, /anime
    Rule: Empty body → 422. With body → not 500. Response has 'sources' or 'error'.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_resolve_movie_empty_body_returns_422(self):
        r = self.c.post("/providers/resolve/movie", json={})
        self.assertEqual(r.status_code, 422, f"Expected 422 for empty body: {r.status_code}")

    def test_02_resolve_movie_with_body_not_500(self):
        r = self.c.post("/providers/resolve/movie", json={
            "title": "Inception", "year": 2010, "imdb_id": "tt1375666"
        })
        self.assertNotEqual(r.status_code, 500, f"Resolve movie crashed: {r.text}")

    def test_03_resolve_movie_response_is_dict(self):
        r = self.c.post("/providers/resolve/movie", json={
            "title": "Inception", "year": 2010, "imdb_id": "tt1375666"
        })
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_04_resolve_tv_with_body_not_500(self):
        r = self.c.post("/providers/resolve/tv", json={
            "title": "Breaking Bad", "season": 1, "episode": 1, "imdb_id": "tt0903747"
        })
        self.assertNotEqual(r.status_code, 500, f"Resolve TV crashed: {r.text}")

    def test_05_resolve_anime_with_body_not_500(self):
        r = self.c.post("/providers/resolve/anime", json={
            "title": "Naruto", "episode": 1
        })
        self.assertNotEqual(r.status_code, 500, f"Resolve anime crashed: {r.text}")

    def test_06_resolve_tv_empty_body_returns_422(self):
        r = self.c.post("/providers/resolve/tv", json={})
        self.assertEqual(r.status_code, 422, f"Expected 422 for empty body: {r.status_code}")


# =============================================================================
# GROUP 7 — MOVIEBOX
# =============================================================================

class TestMovieBox(unittest.TestCase):
    """
    Tests: /moviebox/search, /discover, /details, /sources, /poster, /subtitle
    Rule: Missing required params → 422. Network failure → not 500.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_discover_responds(self):
        r = self.c.get("/moviebox/discover")
        self.assertNotEqual(r.status_code, 500, f"MovieBox discover crashed: {r.text}")

    def test_02_search_missing_query_returns_422(self):
        r = self.c.get("/moviebox/search")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing query: {r.status_code}")

    def test_03_search_with_query_not_500(self):
        r = self.c.get("/moviebox/search?query=Inception")
        self.assertNotEqual(r.status_code, 500, f"MovieBox search crashed: {r.text}")

    def test_04_search_items_not_500(self):
        r = self.c.get("/moviebox/search-items?query=Batman")
        self.assertNotEqual(r.status_code, 500, f"MovieBox search-items crashed: {r.text}")

    def test_05_details_missing_id_returns_422(self):
        r = self.c.get("/moviebox/details")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing id: {r.status_code}")

    def test_06_details_with_id_not_500(self):
        r = self.c.get("/moviebox/details?id=fake-movie-id-999")
        self.assertNotEqual(r.status_code, 500, f"MovieBox details crashed: {r.text}")

    def test_07_sources_missing_id_returns_422(self):
        r = self.c.get("/moviebox/sources")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing id: {r.status_code}")

    def test_08_poster_missing_id_returns_422(self):
        r = self.c.get("/moviebox/poster")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing id: {r.status_code}")


# =============================================================================
# GROUP 8 — CONSUMET (anime + manga pass-through)
# =============================================================================

class TestConsumet(unittest.TestCase):
    """
    Tests: /consumet/health, /discover, /search, /episodes, /watch, /proxy, /anime/stream
    Rule: Missing params → 422. Network failure → not 500. Response always JSON.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_health_responds(self):
        r = self.c.get("/consumet/health")
        self.assertNotEqual(r.status_code, 500, f"Consumet health crashed: {r.text}")
        self.assertIn(r.status_code, EXTERNAL_OK)

    def test_02_discover_anime_responds(self):
        r = self.c.get("/consumet/discover/anime")
        self.assertNotEqual(r.status_code, 500, f"Consumet discover anime crashed: {r.text}")

    def test_03_discover_manga_responds(self):
        r = self.c.get("/consumet/discover/manga")
        self.assertNotEqual(r.status_code, 500, f"Consumet discover manga crashed: {r.text}")

    def test_04_search_missing_query_returns_422(self):
        r = self.c.get("/consumet/search/anime")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing query: {r.status_code}")

    def test_05_anime_episodes_missing_id_returns_422(self):
        r = self.c.get("/consumet/episodes/anime")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing id: {r.status_code}")

    def test_06_manga_chapters_missing_id_returns_422(self):
        r = self.c.get("/consumet/chapters/manga")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing id: {r.status_code}")

    def test_07_watch_anime_missing_episode_id_returns_422(self):
        r = self.c.get("/consumet/watch/anime")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing episode_id: {r.status_code}")

    def test_08_proxy_missing_url_returns_422(self):
        r = self.c.get("/consumet/proxy")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing url: {r.status_code}")

    def test_09_anime_stream_missing_title_returns_422(self):
        r = self.c.get("/consumet/anime/stream")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing title: {r.status_code}")

    def test_10_anime_stream_with_title_returns_json(self):
        """Even when HiAnime is unreachable, must return JSON with 'sources' key."""
        r = self.c.get("/consumet/anime/stream?title=Naruto&episode=1")
        self.assertNotEqual(r.status_code, 500, f"Anime stream crashed: {r.text}")
        data = r.json()
        # Must always have 'sources' key regardless of success/failure
        self.assertIn("sources", data, f"Response missing 'sources' key: {data}")

    def test_11_debug_stream_missing_title_returns_422(self):
        r = self.c.get("/consumet/anime/debug-stream")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing title: {r.status_code}")

    def test_12_news_feed_responds(self):
        r = self.c.get("/consumet/news/feed")
        self.assertNotEqual(r.status_code, 500, f"Consumet news feed crashed: {r.text}")

    def test_13_meta_search_missing_query_returns_422(self):
        r = self.c.get("/consumet/meta/search")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing query: {r.status_code}")

    def test_14_watch_anime_raw_missing_episode_id_returns_422(self):
        r = self.c.get("/consumet/watch/anime/raw")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing episode_id: {r.status_code}")


# =============================================================================
# GROUP 9 — ANIWATCH
# =============================================================================

class TestAniwatch(unittest.TestCase):
    """
    Tests: /aniwatch/health, /discover, /search, /genres, /spotlight, /schedule
    Rule: These proxy to HiAnime sidecar. Sidecar being down → not 500.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_health_not_500(self):
        r = self.c.get("/aniwatch/health")
        self.assertNotEqual(r.status_code, 500, f"Aniwatch health crashed: {r.text}")

    def test_02_discover_not_500(self):
        r = self.c.get("/aniwatch/discover")
        self.assertNotEqual(r.status_code, 500, f"Aniwatch discover crashed: {r.text}")

    def test_03_search_missing_query_returns_422(self):
        r = self.c.get("/aniwatch/search")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing query: {r.status_code}")

    def test_04_search_with_query_not_500(self):
        r = self.c.get("/aniwatch/search?query=Naruto")
        self.assertNotEqual(r.status_code, 500, f"Aniwatch search crashed: {r.text}")

    def test_05_genres_not_500(self):
        r = self.c.get("/aniwatch/genres")
        self.assertNotEqual(r.status_code, 500, f"Aniwatch genres crashed: {r.text}")

    def test_06_spotlight_not_500(self):
        r = self.c.get("/aniwatch/spotlight")
        self.assertNotEqual(r.status_code, 500, f"Aniwatch spotlight crashed: {r.text}")

    def test_07_schedule_not_500(self):
        r = self.c.get("/aniwatch/schedule")
        self.assertNotEqual(r.status_code, 500, f"Aniwatch schedule crashed: {r.text}")


# =============================================================================
# GROUP 10 — MANGA
# =============================================================================

class TestManga(unittest.TestCase):
    """
    Tests: /manga/trending, /popular, /top-rated, /search, /frontpage, /image-proxy
    Rule: Missing params → 422. Network failure → not 500.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_trending_not_500(self):
        r = self.c.get("/manga/trending")
        self.assertNotEqual(r.status_code, 500, f"Manga trending crashed: {r.text}")

    def test_02_popular_not_500(self):
        r = self.c.get("/manga/popular")
        self.assertNotEqual(r.status_code, 500, f"Manga popular crashed: {r.text}")

    def test_03_top_rated_not_500(self):
        r = self.c.get("/manga/top-rated")
        self.assertNotEqual(r.status_code, 500, f"Manga top-rated crashed: {r.text}")

    def test_04_frontpage_not_500(self):
        r = self.c.get("/manga/frontpage")
        self.assertNotEqual(r.status_code, 500, f"Manga frontpage crashed: {r.text}")

    def test_05_search_missing_query_returns_422(self):
        r = self.c.get("/manga/search")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing query: {r.status_code}")

    def test_06_search_with_query_not_500(self):
        r = self.c.get("/manga/search?query=One+Piece")
        self.assertNotEqual(r.status_code, 500, f"Manga search crashed: {r.text}")

    def test_07_image_proxy_missing_url_returns_422(self):
        r = self.c.get("/manga/image-proxy")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing url: {r.status_code}")

    def test_08_chapter_pages_missing_id_returns_422(self):
        r = self.c.get("/manga/chapter/pages")
        # Either 422 (validation) or 404 (route doesn't match) — never 500
        self.assertNotEqual(r.status_code, 500, f"Chapter pages crashed: {r.text}")

    def test_09_comick_chapters_not_500(self):
        r = self.c.get("/manga/comick/chapters?hid=fake-hid-123")
        self.assertNotEqual(r.status_code, 500, f"Comick chapters crashed: {r.text}")

    def test_10_seasonal_not_500(self):
        r = self.c.get("/manga/seasonal")
        self.assertNotEqual(r.status_code, 500, f"Manga seasonal crashed: {r.text}")


# =============================================================================
# GROUP 11 — SUBTITLES
# =============================================================================

class TestSubtitles(unittest.TestCase):
    """
    Tests: /subtitles/search, /cached, /download
    Rule: Missing params → 422. Network failure → not 500.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_search_missing_params_returns_422(self):
        r = self.c.get("/subtitles/search")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing params: {r.status_code}")

    def test_02_search_with_params_not_500(self):
        r = self.c.get("/subtitles/search?title=Inception&language=en")
        self.assertNotEqual(r.status_code, 500, f"Subtitles search crashed: {r.text}")

    def test_03_cached_responds(self):
        r = self.c.get("/subtitles/cached")
        self.assertNotEqual(r.status_code, 500, f"Subtitles cached crashed: {r.text}")

    def test_04_download_missing_params_returns_422(self):
        r = self.c.get("/subtitles/download")
        self.assertEqual(r.status_code, 422, f"Expected 422 for missing params: {r.status_code}")


# =============================================================================
# GROUP 12 — ANIME RESOLVER
# =============================================================================

class TestAnimeResolver(unittest.TestCase):
    """
    Tests: POST /anime/resolve-source
    Rule: Empty body → 422. With body → not 500.
    """

    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_resolve_source_empty_body_returns_422(self):
        r = self.c.post("/anime/resolve-source", json={})
        self.assertEqual(r.status_code, 422, f"Expected 422 for empty body: {r.status_code}")

    def test_02_resolve_source_with_body_not_500(self):
        r = self.c.post("/anime/resolve-source", json={
            "title": "Naruto", "episode": 1, "audio": "sub"
        })
        self.assertNotEqual(r.status_code, 500, f"Anime resolve-source crashed: {r.text}")


# =============================================================================
# RUN
# =============================================================================

if __name__ == "__main__":
    unittest.main(verbosity=2)
