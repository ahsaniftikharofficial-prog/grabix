import asyncio
import json
import os
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


BACKEND_ROOT = Path(__file__).resolve().parents[1]


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
        payload = _run_backend_script(
            """
            import json
            import main

            print(json.dumps(main.get_runtime_bootstrap_snapshot()))
            """
        )

        self.assertFalse(payload["started"])
        self.assertFalse(payload["completed"])
        self.assertFalse(payload["failed"])

    def test_runtime_bootstrap_is_idempotent(self):
        payload = _run_backend_script(
            """
            import json
            import main

            main.ensure_runtime_bootstrap()
            first = main.get_runtime_bootstrap_snapshot()
            main.ensure_runtime_bootstrap()
            second = main.get_runtime_bootstrap_snapshot()

            print(json.dumps({"first": first, "second": second}))
            """
        )

        first = payload["first"]
        second = payload["second"]

        self.assertTrue(first["completed"])
        self.assertFalse(first["failed"])
        self.assertTrue(second["completed"])
        self.assertFalse(second["failed"])
        self.assertEqual(second["step"], "complete")

    def test_consumet_health_reports_fallback_mode_when_sidecar_unset(self):
        previous = os.environ.pop("CONSUMET_API_BASE", None)
        try:
            if str(BACKEND_ROOT) not in sys.path:
                sys.path.insert(0, str(BACKEND_ROOT))

            from app.services import consumet

            health = asyncio.run(consumet.get_health_status())
        finally:
            if previous is not None:
                os.environ["CONSUMET_API_BASE"] = previous

        self.assertFalse(health["configured"])
        self.assertFalse(health["healthy"])
        self.assertEqual(health["mode"], "fallback")
        self.assertIn("fallback", health["message"].lower())

    def test_moviebox_import_falls_back_to_v1_namespace(self):
        if str(BACKEND_ROOT) not in sys.path:
            sys.path.insert(0, str(BACKEND_ROOT))

        import main

        snapshot = {
            "_moviebox_loaded": main._moviebox_loaded,
            "_moviebox_last_fail_time": main._moviebox_last_fail_time,
            "MOVIEBOX_AVAILABLE": main.MOVIEBOX_AVAILABLE,
            "MOVIEBOX_IMPORT_ERROR": main.MOVIEBOX_IMPORT_ERROR,
            "MOVIEBOX_IMPORT_VARIANT": main.MOVIEBOX_IMPORT_VARIANT,
            "MOVIEBOX_DOWNLOAD_REQUEST_HEADERS": dict(main.MOVIEBOX_DOWNLOAD_REQUEST_HEADERS or {}),
            "MovieBoxHomepage": main.MovieBoxHomepage,
            "MovieBoxHotMoviesAndTVSeries": main.MovieBoxHotMoviesAndTVSeries,
            "MovieBoxMovieDetails": main.MovieBoxMovieDetails,
            "MovieBoxPopularSearch": main.MovieBoxPopularSearch,
            "MovieBoxSearch": main.MovieBoxSearch,
            "MovieBoxTrending": main.MovieBoxTrending,
            "MovieBoxTVSeriesDetails": main.MovieBoxTVSeriesDetails,
            "DownloadableMovieFilesDetail": main.DownloadableMovieFilesDetail,
            "DownloadableTVSeriesFilesDetail": main.DownloadableTVSeriesFilesDetail,
            "MovieBoxSession": main.MovieBoxSession,
            "MovieBoxSubjectType": main.MovieBoxSubjectType,
        }

        fake_api = SimpleNamespace(
            Homepage=object(),
            HotMoviesAndTVSeries=object(),
            MovieDetails=object(),
            PopularSearch=object(),
            Search=object(),
            Trending=object(),
            TVSeriesDetails=object(),
            DownloadableMovieFilesDetail=object(),
            DownloadableTVSeriesFilesDetail=object(),
            Session=object(),
            SubjectType=object(),
        )
        fake_constants = SimpleNamespace(DOWNLOAD_REQUEST_HEADERS={"User-Agent": "GRABIX-Test"})

        def fake_import_module(name: str):
            if name == "moviebox_api":
                raise ImportError("top-level symbols are unavailable")
            if name == "moviebox_api.constants":
                raise ImportError("top-level constants are unavailable")
            if name == "moviebox_api.v1":
                return fake_api
            if name == "moviebox_api.v1.constants":
                return fake_constants
            raise ImportError(name)

        try:
            main._moviebox_loaded = False
            main._moviebox_last_fail_time = 0.0
            main.MOVIEBOX_AVAILABLE = False
            main.MOVIEBOX_IMPORT_ERROR = ""
            main.MOVIEBOX_IMPORT_VARIANT = ""
            main.MOVIEBOX_DOWNLOAD_REQUEST_HEADERS = {}

            with mock.patch.object(main.importlib, "import_module", side_effect=fake_import_module):
                loaded = main._ensure_moviebox()

            self.assertTrue(loaded)
            self.assertTrue(main.MOVIEBOX_AVAILABLE)
            self.assertEqual(main.MOVIEBOX_IMPORT_VARIANT, "moviebox_api.v1")
            self.assertEqual(main.MOVIEBOX_DOWNLOAD_REQUEST_HEADERS["User-Agent"], "GRABIX-Test")
        finally:
            main._moviebox_loaded = snapshot["_moviebox_loaded"]
            main._moviebox_last_fail_time = snapshot["_moviebox_last_fail_time"]
            main.MOVIEBOX_AVAILABLE = snapshot["MOVIEBOX_AVAILABLE"]
            main.MOVIEBOX_IMPORT_ERROR = snapshot["MOVIEBOX_IMPORT_ERROR"]
            main.MOVIEBOX_IMPORT_VARIANT = snapshot["MOVIEBOX_IMPORT_VARIANT"]
            main.MOVIEBOX_DOWNLOAD_REQUEST_HEADERS = snapshot["MOVIEBOX_DOWNLOAD_REQUEST_HEADERS"]
            main.MovieBoxHomepage = snapshot["MovieBoxHomepage"]
            main.MovieBoxHotMoviesAndTVSeries = snapshot["MovieBoxHotMoviesAndTVSeries"]
            main.MovieBoxMovieDetails = snapshot["MovieBoxMovieDetails"]
            main.MovieBoxPopularSearch = snapshot["MovieBoxPopularSearch"]
            main.MovieBoxSearch = snapshot["MovieBoxSearch"]
            main.MovieBoxTrending = snapshot["MovieBoxTrending"]
            main.MovieBoxTVSeriesDetails = snapshot["MovieBoxTVSeriesDetails"]
            main.DownloadableMovieFilesDetail = snapshot["DownloadableMovieFilesDetail"]
            main.DownloadableTVSeriesFilesDetail = snapshot["DownloadableTVSeriesFilesDetail"]
            main.MovieBoxSession = snapshot["MovieBoxSession"]
            main.MovieBoxSubjectType = snapshot["MovieBoxSubjectType"]

    def test_anime_jikan_info_path_returns_episodes(self):
        previous = os.environ.pop("CONSUMET_API_BASE", None)
        try:
            if str(BACKEND_ROOT) not in sys.path:
                sys.path.insert(0, str(BACKEND_ROOT))

            from app.services import consumet

            detail_payload = {
                "domain": "anime",
                "provider": "jikan",
                "item": {"id": "42", "provider": "jikan", "title": "Test Anime"},
                "raw": {"mal_id": 42},
            }
            episodes_payload = {
                "provider": "jikan",
                "id": "42",
                "items": [{"id": "jikan:42:1", "provider": "jikan", "number": 1, "title": "Episode 1", "languages": ["original"]}],
            }

            with mock.patch.object(consumet, "_fetch_jikan_anime_full", new=mock.AsyncMock(return_value=detail_payload)), \
                 mock.patch.object(consumet, "_fetch_jikan_anime_episodes", new=mock.AsyncMock(return_value=episodes_payload)):
                detail = asyncio.run(consumet.fetch_domain_info("anime", "jikan", "42"))
        finally:
            if previous is not None:
                os.environ["CONSUMET_API_BASE"] = previous

        self.assertEqual(detail["provider"], "jikan")
        self.assertEqual(detail["item"]["id"], "42")
        self.assertEqual(len(detail["item"]["episodes"]), 1)
        self.assertEqual(detail["item"]["episodes"][0]["id"], "jikan:42:1")

    def test_manga_fallback_uses_native_mangadex_routes_when_sidecar_unset(self):
        previous = os.environ.pop("CONSUMET_API_BASE", None)
        try:
            if str(BACKEND_ROOT) not in sys.path:
                sys.path.insert(0, str(BACKEND_ROOT))

            from app.services import consumet

            mangadex_item = {
                "mangadex_id": "mdx-1",
                "title": "Fallback Manga",
                "description": "Native MangaDex result",
                "cover_image": "https://example.com/cover.jpg",
                "status": "ongoing",
                "genres": ["Action"],
                "year": 2024,
            }
            chapter_item = {
                "chapter_id": "chapter-1",
                "chapter_number": "1",
                "title": "Opening",
                "language": "en",
                "published_at": "2026-04-03T00:00:00Z",
            }
            pages = ["https://example.com/page-1.jpg", "https://example.com/page-2.jpg"]

            with mock.patch.object(consumet, "search_mangadex_manga", new=mock.AsyncMock(return_value=[mangadex_item])), \
                 mock.patch.object(consumet, "get_mangadex_manga_details", new=mock.AsyncMock(return_value=mangadex_item)), \
                 mock.patch.object(consumet, "get_mangadex_chapter_list", new=mock.AsyncMock(return_value=[chapter_item])), \
                 mock.patch.object(consumet, "get_mangadex_chapter_pages", new=mock.AsyncMock(return_value=pages)):
                search_payload = asyncio.run(consumet.search_domain("manga", "Fallback Manga", provider="mangadex"))
                chapter_payload = asyncio.run(consumet.fetch_manga_chapters("mangadex", "mdx-1"))
                read_payload = asyncio.run(consumet.fetch_manga_read("mangadex", "chapter-1"))
        finally:
            if previous is not None:
                os.environ["CONSUMET_API_BASE"] = previous

        self.assertEqual(search_payload["items"][0]["id"], "mdx-1")
        self.assertEqual(search_payload["items"][0]["mangadex_id"], "mdx-1")
        self.assertEqual(chapter_payload["items"][0]["id"], "chapter-1")
        self.assertEqual(chapter_payload["items"][0]["number"], "1")
        self.assertEqual(read_payload["pages"], pages)


if __name__ == "__main__":
    unittest.main()
