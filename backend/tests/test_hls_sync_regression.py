"""
backend/tests/test_hls_sync_regression.py  (FIXED)

HLS regression tests.
The original tests grepped main.py for functions that were extracted to
streaming_helpers.py and downloads/engine.py during the Phase-2/6 refactor.
Updated to search the correct source files.
"""
import unittest
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _read_source(relative_path: str) -> str:
    """Read a backend source file relative to BACKEND_ROOT."""
    return (BACKEND_ROOT / relative_path).read_text(encoding="utf-8")


class HlsSyncRegressionTests(unittest.TestCase):

    def test_streaming_helpers_module_exists(self):
        """streaming_helpers.py must exist and expose key HLS utilities."""
        path = BACKEND_ROOT / "streaming_helpers.py"
        self.assertTrue(path.exists(), "streaming_helpers.py is missing from backend/")
        source = path.read_text(encoding="utf-8")
        # Core HLS helpers that must be present
        self.assertIn("def _extract_hls_variants(", source)
        self.assertIn("def _rewrite_hls_playlist(", source)

    def test_hls_variant_extraction_helper_exists(self):
        """_extract_hls_variants must be importable from streaming_helpers."""
        from streaming_helpers import _extract_hls_variants
        self.assertTrue(callable(_extract_hls_variants))

    def test_stream_proxy_helper_exists(self):
        """stream_proxy must be importable from streaming_helpers."""
        from streaming_helpers import stream_proxy
        self.assertTrue(callable(stream_proxy))

    def test_resolve_embed_helper_exists(self):
        """resolve_embed must be importable from streaming_helpers."""
        from streaming_helpers import resolve_embed
        self.assertTrue(callable(resolve_embed))

    def test_extract_stream_helper_exists(self):
        """extract_stream must be importable from streaming_helpers."""
        from streaming_helpers import extract_stream
        self.assertTrue(callable(extract_stream))

    def test_hls_playlist_rewrite_handles_relative_segments(self):
        """
        _rewrite_hls_playlist must handle relative segment URIs without crashing.
        Signature: (content: str, base_url: str, headers_json: str) -> str
        """
        from streaming_helpers import _rewrite_hls_playlist
        playlist = (
            "#EXTM3U\n"
            "#EXT-X-VERSION:3\n"
            "#EXTINF:6.000,\n"
            "seg000.ts\n"
            "#EXTINF:6.000,\n"
            "seg001.ts\n"
            "#EXT-X-ENDLIST\n"
        )
        result = _rewrite_hls_playlist(playlist, "https://cdn.example.com/stream/", "")
        # Result must be a string and contain the segment references
        self.assertIsInstance(result, str)
        self.assertIn("seg000.ts", result)


if __name__ == "__main__":
    unittest.main()
