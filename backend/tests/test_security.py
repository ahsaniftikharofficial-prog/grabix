import tempfile
import unittest
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi import HTTPException

from app.services.network_policy import validate_outbound_target
from app.services.security import ensure_safe_managed_path, validate_outbound_url


class SecurityServiceTests(unittest.TestCase):
    def test_validate_outbound_url_allows_approved_media_host(self):
        result = validate_outbound_url("https://archive.org/details/example-video")
        self.assertEqual(result, "https://archive.org/details/example-video")

    def test_validate_outbound_url_blocks_private_host(self):
        with self.assertRaises(HTTPException) as context:
            validate_outbound_url("http://127.0.0.1:8000/private")
        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("local network hosts are blocked", str(context.exception.detail))

    def test_validate_outbound_url_blocks_unapproved_host(self):
        with self.assertRaises(HTTPException) as context:
            validate_outbound_url("https://example.com/video.mp4")
        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("approved media allowlist", str(context.exception.detail))

    def test_validate_outbound_url_uses_suffix_boundary_matching(self):
        with self.assertRaises(HTTPException) as context:
            validate_outbound_url(
                "https://evilyoutube.com/video.mp4",
                allowed_hosts=("youtube.com",),
            )
        self.assertEqual(context.exception.status_code, 400)

    def test_public_user_target_blocks_private_network_hosts(self):
        with self.assertRaises(HTTPException) as context:
            validate_outbound_target("http://127.0.0.1:9000/file.mp4", mode="public_user_target")
        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("local network hosts are blocked", str(context.exception.detail))

    def test_ensure_safe_managed_path_allows_inside_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            nested = Path(temp_dir) / "Videos" / "movie.mp4"
            nested.parent.mkdir(parents=True, exist_ok=True)
            nested.write_text("ok", encoding="utf-8")
            resolved = ensure_safe_managed_path(str(nested), temp_dir, must_exist=True, expect_file=True)
            self.assertEqual(resolved, nested.resolve())

    def test_ensure_safe_managed_path_blocks_escape_outside_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            outside = Path(temp_dir).parent / "outside-file.txt"
            outside.write_text("bad", encoding="utf-8")
            try:
                with self.assertRaises(HTTPException) as context:
                    ensure_safe_managed_path(str(outside), temp_dir, must_exist=True, expect_file=True)
                self.assertEqual(context.exception.status_code, 400)
                self.assertIn("outside the managed GRABIX folder", str(context.exception.detail))
            finally:
                outside.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
