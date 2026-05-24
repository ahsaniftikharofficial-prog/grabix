"""
GRABIX TEST SUITE
=================
Drop this file in your project root (next to the backend/ folder).

HOW TO RUN:
    cd grabix-master
    pip install pytest httpx --break-system-packages
    pytest tests.py -v

Run just one section:
    pytest tests.py -v -k "Unit"
    pytest tests.py -v -k "Downloads"
    pytest tests.py -v -k "Streaming"

WHAT THIS COVERS:
    Part 1 — Unit tests   (pure functions, no server needed, instant)
    Part 2 — Smoke tests  (is the app alive? 10 critical checks)
    Part 3 — Downloads    (queue, actions, status)
    Part 4 — Streaming    (URL detection, HLS, embed)
    Part 5 — Settings     (read, write, password)
    Part 6 — Metadata     (TMDB, IMDb routes)
    Part 7 — Providers    (movie/tv/anime resolution)
    Part 8 — MovieBox     (search, details, sources)
    Part 9 — Manga        (trending, search, chapters)
    Part 10 — Subtitles   (search, download)
    Part 11 — Infrastructure (health, cache, diagnostics)

RULES:
    500 = our code crashed            → NEVER acceptable
    422 = missing required parameter  → correct behaviour
    502 = external service unreachable → acceptable (not our fault)
    200/400/404 = normal responses    → fine
"""

import sys
import unittest
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
# This file lives in the project root. Backend lives in backend/.
ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Acceptable statuses when external services may be unreachable
NETWORK_OK = {200, 400, 404, 422, 502, 503}


# =============================================================================
# PART 1 — UNIT TESTS (pure functions, zero network, instant)
# =============================================================================
# These test the logic inside your helper functions directly.
# If these break it means the core math/parsing/logic broke — not a network issue.

class TestUnit_FormatBytes(unittest.TestCase):
    """_fmt_bytes turns raw byte counts into human-readable strings."""

    def setUp(self):
        from downloads.engine import _fmt_bytes
        self.fmt = _fmt_bytes

    def test_zero(self):
        self.assertEqual(self.fmt(0), "0.0 B")

    def test_bytes(self):
        result = self.fmt(500)
        self.assertIn("500", result)
        self.assertIn("B", result)

    def test_kilobytes(self):
        result = self.fmt(2048)
        self.assertTrue("2" in result and ("KB" in result or "MB" in result))

    def test_megabytes(self):
        result = self.fmt(5 * 1024 * 1024)
        self.assertIn("MB", result)

    def test_gigabytes(self):
        result = self.fmt(2 * 1024 * 1024 * 1024)
        self.assertIn("GB", result)

    def test_returns_string(self):
        self.assertIsInstance(self.fmt(12345), str)


class TestUnit_FormatEta(unittest.TestCase):
    """_fmt_eta_secs turns seconds into human-readable time."""

    def setUp(self):
        from downloads.engine import _fmt_eta_secs
        self.fmt = _fmt_eta_secs

    def test_none_returns_empty(self):
        self.assertEqual(self.fmt(None), "")

    def test_zero_returns_empty(self):
        self.assertEqual(self.fmt(0), "")

    def test_negative_returns_empty(self):
        self.assertEqual(self.fmt(-5), "")

    def test_seconds(self):
        result = self.fmt(45)
        self.assertIn("s", result)
        self.assertIn("45", result)

    def test_minutes(self):
        result = self.fmt(90)
        self.assertIn("m", result)

    def test_hours(self):
        result = self.fmt(3700)
        self.assertIn("h", result)

    def test_returns_string(self):
        self.assertIsInstance(self.fmt(120), str)


class TestUnit_QualityLabel(unittest.TestCase):
    """_quality_label_to_height converts labels like '1080p' to pixel heights."""

    def setUp(self):
        from downloads.engine import _quality_label_to_height
        self.fn = _quality_label_to_height

    def test_1080p(self):
        self.assertEqual(self.fn("1080p"), 1080)

    def test_720p(self):
        self.assertEqual(self.fn("720p"), 720)

    def test_480p(self):
        self.assertEqual(self.fn("480p"), 480)

    def test_4k(self):
        self.assertEqual(self.fn("4k"), 2160)

    def test_hd_alias(self):
        self.assertEqual(self.fn("hd"), 1080)

    def test_sd_alias(self):
        self.assertEqual(self.fn("sd"), 480)

    def test_unknown_returns_default(self):
        result = self.fn("unknown_quality")
        self.assertIsInstance(result, int)
        self.assertGreater(result, 0)


class TestUnit_IsDirectMediaUrl(unittest.TestCase):
    """_is_direct_media_url detects whether a URL points to a direct media file."""

    def setUp(self):
        from downloads.engine import _is_direct_media_url
        self.fn = _is_direct_media_url

    def test_mp4_is_direct(self):
        self.assertTrue(self.fn("https://example.com/video.mp4"))

    def test_m3u8_is_direct(self):
        self.assertTrue(self.fn("https://cdn.example.com/stream.m3u8"))

    def test_mkv_is_direct(self):
        self.assertTrue(self.fn("https://example.com/file.mkv"))

    def test_php_page_is_not_direct(self):
        self.assertFalse(self.fn("https://example.com/watch.php?id=123"))

    def test_html_page_is_not_direct(self):
        self.assertFalse(self.fn("https://example.com/embed/player"))

    def test_empty_string_is_not_direct(self):
        self.assertFalse(self.fn(""))


class TestUnit_LooksLikePlayableUrl(unittest.TestCase):
    """_looks_like_playable_media_url detects URLs containing playable media tokens."""

    def setUp(self):
        from app.services.streaming_helpers import _looks_like_playable_media_url
        self.fn = _looks_like_playable_media_url

    def test_m3u8_url(self):
        self.assertTrue(self.fn("https://cdn.example.com/hls/stream.m3u8"))

    def test_mp4_url(self):
        self.assertTrue(self.fn("https://example.com/files/video.mp4"))

    def test_random_url_is_not_playable(self):
        self.assertFalse(self.fn("https://example.com/page/about"))

    def test_empty_is_not_playable(self):
        self.assertFalse(self.fn(""))


class TestUnit_ProxyHlsResourcePath(unittest.TestCase):
    """_proxy_hls_resource_path maps resource URLs to the correct proxy endpoint."""

    def setUp(self):
        from app.services.streaming_helpers import _proxy_hls_resource_path
        self.fn = _proxy_hls_resource_path

    def test_m3u8_goes_to_playlist(self):
        result = self.fn("https://cdn.example.com/stream.m3u8")
        self.assertIn("playlist", result)

    def test_ts_segment(self):
        result = self.fn("https://cdn.example.com/segment001.ts")
        self.assertIn("segment", result)

    def test_vtt_subtitle(self):
        result = self.fn("https://cdn.example.com/subtitle.vtt")
        self.assertIn("subtitle", result)

    def test_returns_string(self):
        result = self.fn("https://cdn.example.com/anything.bin")
        self.assertIsInstance(result, str)
        self.assertTrue(result.startswith("/stream/proxy/"))


class TestUnit_ExtractIframeSrc(unittest.TestCase):
    """_extract_iframe_src pulls the src URL out of an iframe HTML tag."""

    def setUp(self):
        from app.services.streaming_helpers import _extract_iframe_src
        self.fn = _extract_iframe_src

    def test_standard_iframe(self):
        html = '<iframe src="https://example.com/embed/abc123" width="640"></iframe>'
        result = self.fn(html)
        self.assertEqual(result, "https://example.com/embed/abc123")

    def test_no_iframe_returns_empty(self):
        result = self.fn("<div>No iframe here</div>")
        self.assertEqual(result, "")

    def test_empty_html_returns_empty(self):
        result = self.fn("")
        self.assertEqual(result, "")


class TestUnit_ExtractHlsVariants(unittest.TestCase):
    """_extract_hls_variants parses an HLS master playlist into a list of quality options."""

    def setUp(self):
        from app.services.streaming_helpers import _extract_hls_variants
        self.fn = _extract_hls_variants

    def test_parses_two_variants(self):
        playlist = (
            "#EXTM3U\n"
            "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\n"
            "720p.m3u8\n"
            "#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1920x1080\n"
            "1080p.m3u8\n"
        )
        result = self.fn(playlist, "https://cdn.example.com/hls/")
        self.assertEqual(len(result), 2)

    def test_variant_has_required_keys(self):
        playlist = (
            "#EXTM3U\n"
            "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\n"
            "stream.m3u8\n"
        )
        variants = self.fn(playlist, "https://cdn.example.com/hls/")
        self.assertEqual(len(variants), 1)
        v = variants[0]
        self.assertIn("label", v)
        self.assertIn("url", v)
        self.assertIn("bandwidth", v)

    def test_url_is_absolute(self):
        playlist = (
            "#EXTM3U\n"
            "#EXT-X-STREAM-INF:BANDWIDTH=500000\n"
            "relative/path.m3u8\n"
        )
        variants = self.fn(playlist, "https://cdn.example.com/hls/")
        self.assertTrue(variants[0]["url"].startswith("https://"))

    def test_empty_playlist_returns_empty_list(self):
        result = self.fn("", "https://cdn.example.com/")
        self.assertEqual(result, [])


class TestUnit_PasswordHashing(unittest.TestCase):
    """Password hashing must produce a verifiable hash, and wrong passwords must fail."""

    def setUp(self):
        from app.services.settings_service import _hash_adult_password, _verify_adult_password
        self.hash_fn = _hash_adult_password
        self.verify_fn = _verify_adult_password

    def test_hash_returns_string(self):
        result = self.hash_fn("mypassword123")
        self.assertIsInstance(result, str)

    def test_hash_is_not_plaintext(self):
        result = self.hash_fn("mypassword123")
        self.assertNotEqual(result, "mypassword123")

    def test_correct_password_verifies(self):
        hashed = self.hash_fn("secret99")
        self.assertTrue(self.verify_fn("secret99", hashed))

    def test_wrong_password_fails(self):
        hashed = self.hash_fn("correct_password")
        self.assertFalse(self.verify_fn("wrong_password", hashed))

    def test_empty_password_handled(self):
        hashed = self.hash_fn("")
        result = self.verify_fn("", hashed)
        self.assertIsInstance(result, bool)


class TestUnit_NormalizeHeaders(unittest.TestCase):
    """_normalize_request_headers always returns a dict with a User-Agent."""

    def setUp(self):
        from app.services.streaming_helpers import _normalize_request_headers
        self.fn = _normalize_request_headers

    def test_none_input_has_user_agent(self):
        result = self.fn(None)
        self.assertIn("User-Agent", result)

    def test_custom_headers_are_kept(self):
        result = self.fn({"X-Custom": "value"})
        self.assertIn("X-Custom", result)
        self.assertIn("User-Agent", result)

    def test_referer_adds_origin(self):
        result = self.fn({"Referer": "https://example.com/page"})
        self.assertIn("Origin", result)
        self.assertIn("example.com", result["Origin"])

    def test_returns_dict(self):
        result = self.fn({})
        self.assertIsInstance(result, dict)


# =============================================================================
# PART 2 — SMOKE TESTS (is the app alive?)
# =============================================================================
# These 10 tests are your minimum safety net.
# If ANY of these fail, something is seriously broken.

class TestSmoke(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_app_responds(self):
        r = self.c.get("/")
        self.assertNotEqual(r.status_code, 500, "App root crashed")

    def test_02_health_ping(self):
        r = self.c.get("/health/ping")
        self.assertEqual(r.status_code, 200, f"Health ping failed: {r.text}")
        data = r.json()
        self.assertTrue(data.get("ok"), f"Health returned ok=False: {data}")

    def test_03_downloads_list(self):
        r = self.c.get("/downloads")
        self.assertEqual(r.status_code, 200, f"Downloads list crashed: {r.text}")
        self.assertIsInstance(r.json(), list)

    def test_04_settings_readable(self):
        r = self.c.get("/settings")
        self.assertEqual(r.status_code, 200, f"Settings crashed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_05_cache_stats(self):
        r = self.c.get("/cache/stats")
        self.assertEqual(r.status_code, 200, f"Cache stats crashed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_06_ffmpeg_status(self):
        r = self.c.get("/ffmpeg-status")
        self.assertEqual(r.status_code, 200, f"FFmpeg status crashed: {r.text}")
        self.assertIn("available", r.json())

    def test_07_providers_status(self):
        r = self.c.get("/providers/status")
        self.assertIn(r.status_code, [200, 503], f"Providers status crashed: {r.text}")
        self.assertIsInstance(r.json(), dict)

    def test_08_circuit_breaker(self):
        r = self.c.get("/health/circuit-breaker/status")
        self.assertEqual(r.status_code, 200, f"Circuit breaker crashed: {r.text}")

    def test_09_diagnostics_logs(self):
        r = self.c.get("/diagnostics/logs?limit=5")
        self.assertEqual(r.status_code, 200, f"Diagnostics crashed: {r.text}")
        self.assertIn("events", r.json())

    def test_10_openapi_schema(self):
        r = self.c.get("/openapi.json")
        self.assertEqual(r.status_code, 200, f"OpenAPI schema crashed: {r.text}")
        self.assertIn("paths", r.json())


# =============================================================================
# PART 3 — DOWNLOADS
# =============================================================================

class TestDownloads(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_list_returns_list(self):
        r = self.c.get("/downloads")
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_02_start_missing_url_returns_422(self):
        r = self.c.post("/download", json={"title": "test"})
        self.assertEqual(r.status_code, 422, "Missing URL should be 422")

    def test_03_start_fake_url_does_not_crash(self):
        r = self.c.post("/download", json={
            "url": "https://example.com/fake.mp4",
            "title": "Test",
            "dl_type": "video",
            "quality": "best"
        })
        self.assertNotEqual(r.status_code, 500, f"Start download crashed: {r.text}")
        self.assertIn(r.status_code, [200, 201, 202, 400, 422])

    def test_04_status_fake_id_not_500(self):
        r = self.c.get("/download-status/fake-id-xyz")
        self.assertNotEqual(r.status_code, 500)
        self.assertIn(r.status_code, [200, 404])

    def test_05_progress_fake_id_not_500(self):
        r = self.c.get("/progress/fake-id-xyz")
        self.assertNotEqual(r.status_code, 500)

    def test_06_action_pause_fake_id_not_500(self):
        r = self.c.post("/downloads/fake-id-xyz/action", json={"action": "pause"})
        self.assertNotEqual(r.status_code, 500)

    def test_07_action_resume_fake_id_not_500(self):
        r = self.c.post("/downloads/fake-id-xyz/action", json={"action": "resume"})
        self.assertNotEqual(r.status_code, 500)

    def test_08_action_cancel_fake_id_not_500(self):
        r = self.c.post("/downloads/fake-id-xyz/action", json={"action": "cancel"})
        self.assertNotEqual(r.status_code, 500)

    def test_09_delete_fake_id_not_500(self):
        r = self.c.delete("/downloads/fake-id-xyz")
        self.assertNotEqual(r.status_code, 500)

    def test_10_stop_all_not_500(self):
        r = self.c.post("/downloads/stop-all")
        self.assertNotEqual(r.status_code, 500)

    def test_11_runtime_dependencies_shape(self):
        r = self.c.get("/runtime/dependencies")
        self.assertNotEqual(r.status_code, 500)
        self.assertIsInstance(r.json(), (dict, list))

    def test_12_stream_endpoint_registered(self):
        import core.main as cm
        paths = {getattr(route, "path", "") for route in cm.app.routes}
        self.assertIn("/downloads/stream", paths, "SSE /downloads/stream not registered")


# =============================================================================
# PART 4 — STREAMING
# =============================================================================

class TestStreaming(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_ffmpeg_status_has_available_key(self):
        r = self.c.get("/ffmpeg-status")
        self.assertEqual(r.status_code, 200)
        self.assertIn("available", r.json())

    def test_02_resolve_embed_missing_url_is_422(self):
        r = self.c.get("/resolve-embed")
        self.assertEqual(r.status_code, 422)

    def test_03_resolve_embed_fake_url_not_500(self):
        r = self.c.get("/resolve-embed?url=https%3A%2F%2Fexample.com%2Fembed%2Ffake")
        self.assertNotEqual(r.status_code, 500)

    def test_04_stream_variants_missing_url_is_422(self):
        r = self.c.get("/stream/variants")
        self.assertEqual(r.status_code, 422)

    def test_05_extract_stream_missing_url_is_422(self):
        r = self.c.get("/extract-stream")
        self.assertEqual(r.status_code, 422)

    def test_06_check_link_missing_url_is_422(self):
        r = self.c.get("/check-link")
        self.assertEqual(r.status_code, 422)

    def test_07_check_link_real_url_not_500(self):
        import urllib.parse
        url = urllib.parse.quote(
            "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
            safe=""
        )
        r = self.c.get(f"/check-link?url={url}")
        self.assertNotEqual(r.status_code, 500)


# =============================================================================
# PART 5 — SETTINGS
# =============================================================================

class TestSettings(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_settings_read_returns_dict(self):
        r = self.c.get("/settings")
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), dict)

    def test_02_settings_has_core_fields(self):
        r = self.c.get("/settings")
        data = r.json()
        core_keys = {"download_path", "quality", "theme", "language", "download_folder"}
        found = core_keys & set(data.keys())
        self.assertTrue(len(found) > 0, f"Settings has none of the expected keys. Got: {list(data.keys())}")

    def test_03_settings_write_not_500(self):
        r = self.c.post("/settings", json={"theme": "dark"})
        self.assertNotEqual(r.status_code, 500)
        self.assertIn(r.status_code, [200, 400, 422])

    def test_04_settings_still_readable_after_write(self):
        before = self.c.get("/settings").json()
        self.c.post("/settings", json={**before, "theme": "dark"})
        after = self.c.get("/settings")
        self.assertEqual(after.status_code, 200)
        self.assertIsInstance(after.json(), dict)

    def test_05_tmdb_status_responds(self):
        r = self.c.get("/tmdb-status")
        self.assertNotEqual(r.status_code, 500)
        self.assertIsInstance(r.json(), dict)

    def test_06_adult_content_configure_not_500(self):
        r = self.c.post("/settings/adult-content/configure", json={"enabled": False})
        self.assertNotEqual(r.status_code, 500)

    def test_07_adult_unlock_wrong_pin_is_4xx(self):
        r = self.c.post("/settings/adult-content/unlock", json={"pin": "0000"})
        self.assertNotEqual(r.status_code, 500)
        self.assertIn(r.status_code, [200, 400, 401, 403, 422])


# =============================================================================
# PART 6 — METADATA (TMDB + IMDb)
# =============================================================================

class TestMetadata(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_tmdb_discover_movie_not_500(self):
        r = self.c.get("/tmdb/discover?media_type=movie&category=trending")
        self.assertNotEqual(r.status_code, 500)

    def test_02_tmdb_discover_tv_not_500(self):
        r = self.c.get("/tmdb/discover?media_type=tv&category=popular")
        self.assertNotEqual(r.status_code, 500)

    def test_03_tmdb_search_missing_query_is_422(self):
        r = self.c.get("/tmdb/search?media_type=movie")
        self.assertEqual(r.status_code, 422)

    def test_04_tmdb_search_with_query_not_500(self):
        r = self.c.get("/tmdb/search?media_type=movie&query=Inception")
        self.assertNotEqual(r.status_code, 500)

    def test_05_tmdb_details_missing_id_is_422(self):
        r = self.c.get("/tmdb/details?media_type=movie")
        self.assertEqual(r.status_code, 422)

    def test_06_tmdb_details_with_id_not_500(self):
        r = self.c.get("/tmdb/details?media_type=movie&id=27205")
        self.assertNotEqual(r.status_code, 500)

    def test_07_tmdb_tv_season_missing_season_is_422(self):
        r = self.c.get("/tmdb/tv-season?id=1399")
        self.assertEqual(r.status_code, 422)

    def test_08_imdb_chart_missing_param_is_422(self):
        r = self.c.get("/imdb/chart")
        self.assertEqual(r.status_code, 422)

    def test_09_imdb_top250_not_500(self):
        r = self.c.get("/imdb/chart?chart=top250")
        self.assertNotEqual(r.status_code, 500)


# =============================================================================
# PART 7 — PROVIDERS
# =============================================================================

class TestProviders(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_resolve_movie_empty_body_is_422(self):
        r = self.c.post("/providers/resolve/movie", json={})
        self.assertEqual(r.status_code, 422)

    def test_02_resolve_movie_with_body_not_500(self):
        r = self.c.post("/providers/resolve/movie", json={
            "title": "Inception", "year": 2010, "imdb_id": "tt1375666"
        })
        self.assertNotEqual(r.status_code, 500)

    def test_03_resolve_movie_returns_dict(self):
        r = self.c.post("/providers/resolve/movie", json={
            "title": "Inception", "year": 2010, "imdb_id": "tt1375666"
        })
        if r.status_code == 200:
            self.assertIsInstance(r.json(), dict)

    def test_04_resolve_tv_with_body_not_500(self):
        r = self.c.post("/providers/resolve/tv", json={
            "title": "Breaking Bad", "season": 1, "episode": 1, "imdb_id": "tt0903747"
        })
        self.assertNotEqual(r.status_code, 500)

    def test_05_resolve_tv_empty_body_is_422(self):
        r = self.c.post("/providers/resolve/tv", json={})
        self.assertEqual(r.status_code, 422)

    def test_06_resolve_anime_with_body_not_500(self):
        r = self.c.post("/providers/resolve/anime", json={
            "title": "Naruto", "episode": 1
        })
        self.assertNotEqual(r.status_code, 500)


# =============================================================================
# PART 8 — MOVIEBOX
# =============================================================================

class TestMovieBox(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_discover_not_500(self):
        r = self.c.get("/moviebox/discover")
        self.assertNotEqual(r.status_code, 500)

    def test_02_search_missing_query_is_422(self):
        r = self.c.get("/moviebox/search")
        self.assertEqual(r.status_code, 422)

    def test_03_search_with_query_not_500(self):
        r = self.c.get("/moviebox/search?query=Inception")
        self.assertNotEqual(r.status_code, 500)

    def test_04_details_missing_id_is_422(self):
        r = self.c.get("/moviebox/details")
        self.assertEqual(r.status_code, 422)

    def test_05_details_fake_id_not_500(self):
        r = self.c.get("/moviebox/details?id=fake-id-999")
        self.assertNotEqual(r.status_code, 500)

    def test_06_sources_missing_id_is_422(self):
        r = self.c.get("/moviebox/sources")
        self.assertEqual(r.status_code, 422)

    def test_07_poster_missing_id_is_422(self):
        r = self.c.get("/moviebox/poster")
        self.assertEqual(r.status_code, 422)


# =============================================================================
# PART 9 — MANGA
# =============================================================================

class TestManga(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_trending_not_500(self):
        r = self.c.get("/manga/trending")
        self.assertNotEqual(r.status_code, 500)

    def test_02_popular_not_500(self):
        r = self.c.get("/manga/popular")
        self.assertNotEqual(r.status_code, 500)

    def test_03_top_rated_not_500(self):
        r = self.c.get("/manga/top-rated")
        self.assertNotEqual(r.status_code, 500)

    def test_04_search_missing_query_is_422(self):
        r = self.c.get("/manga/search")
        self.assertEqual(r.status_code, 422)

    def test_05_search_with_query_not_500(self):
        r = self.c.get("/manga/search?query=One+Piece")
        self.assertNotEqual(r.status_code, 500)

    def test_06_image_proxy_missing_url_is_422(self):
        r = self.c.get("/manga/image-proxy")
        self.assertEqual(r.status_code, 422)

    def test_07_frontpage_not_500(self):
        r = self.c.get("/manga/frontpage")
        self.assertNotEqual(r.status_code, 500)

    def test_08_seasonal_not_500(self):
        r = self.c.get("/manga/seasonal")
        self.assertNotEqual(r.status_code, 500)


# =============================================================================
# PART 10 — SUBTITLES
# =============================================================================

class TestSubtitles(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_search_missing_params_is_422(self):
        r = self.c.get("/subtitles/search")
        self.assertEqual(r.status_code, 422)

    def test_02_search_with_params_not_500(self):
        r = self.c.get("/subtitles/search?title=Inception&language=en")
        self.assertNotEqual(r.status_code, 500)

    def test_03_cached_list_not_500(self):
        r = self.c.get("/subtitles/cached")
        self.assertNotEqual(r.status_code, 500)

    def test_04_download_missing_params_is_422(self):
        r = self.c.get("/subtitles/download")
        self.assertEqual(r.status_code, 422)


# =============================================================================
# PART 11 — INFRASTRUCTURE (health, cache, diagnostics)
# =============================================================================

class TestInfrastructure(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        import main
        cls.c = TestClient(main.app, raise_server_exceptions=False)

    def test_01_health_services(self):
        r = self.c.get("/health/services")
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), dict)

    def test_02_health_capabilities(self):
        r = self.c.get("/health/capabilities")
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), dict)

    def test_03_health_log(self):
        r = self.c.get("/health/log")
        self.assertNotEqual(r.status_code, 500)

    def test_04_cache_clear_not_500(self):
        r = self.c.post("/cache/clear")
        self.assertNotEqual(r.status_code, 500)

    def test_05_circuit_breaker_reset_not_500(self):
        r = self.c.post("/health/circuit-breaker/reset")
        self.assertNotEqual(r.status_code, 500)

    def test_06_self_test_returns_json(self):
        r = self.c.get("/diagnostics/self-test")
        self.assertIn(r.status_code, [200, 500, 503])
        try:
            data = r.json()
            self.assertIsInstance(data, dict)
        except Exception:
            self.fail(f"Self-test returned non-JSON: {r.text[:200]}")


# =============================================================================
# RUN
# =============================================================================

if __name__ == "__main__":
    unittest.main(verbosity=2)
