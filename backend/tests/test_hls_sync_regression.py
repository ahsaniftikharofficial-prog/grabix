import unittest
from pathlib import Path


class HlsSyncRegressionTests(unittest.TestCase):
    def test_anime_downloads_force_sync_safe_hls_pipeline(self):
        backend_main = Path(__file__).resolve().parents[1] / "main.py"
        source = backend_main.read_text(encoding="utf-8")
        self.assertIn("def _should_force_sync_safe_hls(", source)
        self.assertIn('if category == "anime":', source)
        self.assertIn('raise _ForceFallback("Anime downloads use the sync-safe HLS pipeline to keep audio and video aligned.")', source)

    def test_hls_eta_estimation_uses_bytes_not_segment_count(self):
        backend_main = Path(__file__).resolve().parents[1] / "main.py"
        source = backend_main.read_text(encoding="utf-8")
        self.assertIn("def _estimate_hls_remaining_seconds(", source)
        self.assertIn("average_segment_bytes = downloaded_bytes / max(completed_segments, 1)", source)
        self.assertIn("remaining_bytes = max(estimated_total_bytes - downloaded_bytes, 0.0)", source)

    def test_retry_state_preserves_progress_and_clears_transient_speed(self):
        backend_main = Path(__file__).resolve().parents[1] / "main.py"
        source = backend_main.read_text(encoding="utf-8")
        self.assertIn('def _retry_progress_mode(', source)
        self.assertIn('"progress_mode": _retry_progress_mode(current_item)', source)
        self.assertIn('"speed": ""', source)
        self.assertIn('"eta": ""', source)

    def test_hls_download_prefers_parallel_path_with_sync_safe_fallback(self):
        backend_main = Path(__file__).resolve().parents[1] / "main.py"
        source = backend_main.read_text(encoding="utf-8")
        start = source.index("def _download_hls_media(")
        end = source.index("\ndef _download_strategy_for(", start)
        block = source[start:end]

        self.assertIn("Parallel HLS segment downloader.", block)
        self.assertIn("fall back to FFmpeg's native HLS demuxer below", block)
        self.assertIn('HLS_WORKERS = 12', block)
        self.assertIn('FFmpeg concat-mux .ts segments', block)
        self.assertIn('Downloading via FFmpeg (fMP4/encrypted stream)...', block)
        self.assertIn('"-max_interleave_delta", "0"', block)


if __name__ == "__main__":
    unittest.main()
