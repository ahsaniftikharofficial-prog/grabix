import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
import sys
from unittest import mock

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services import runtime_config
import db_helpers


class StorageRuntimeTests(unittest.TestCase):
    def tearDown(self):
        runtime_config.reset_runtime_config_caches()

    def test_storage_layout_migrates_legacy_state_into_app_state_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            legacy_root = temp_root / "legacy"
            preferred_root = temp_root / "app-state"
            logs_dir = legacy_root / "logs"
            logs_dir.mkdir(parents=True, exist_ok=True)

            db_path = legacy_root / "grabix.db"
            con = sqlite3.connect(db_path)
            try:
                con.execute("CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT)")
                con.execute("INSERT INTO demo (value) VALUES (?)", ("ok",))
                con.commit()
            finally:
                con.close()

            settings_path = legacy_root / "grabix_settings.json"
            settings_path.write_text(json.dumps({"theme": "light"}), encoding="utf-8")
            (logs_dir / "backend.log").write_text("ready", encoding="utf-8")

            with mock.patch.object(runtime_config, "LEGACY_DOWNLOAD_ROOT", legacy_root), \
                 mock.patch.dict(os.environ, {runtime_config.APP_STATE_ROOT_ENV: str(preferred_root)}, clear=False):
                runtime_config.reset_runtime_config_caches()
                layout = runtime_config.storage_layout()

            self.assertEqual(Path(layout["active_root"]), preferred_root.resolve())
            self.assertEqual(layout["migration"]["status"], "migrated")
            self.assertTrue((preferred_root / "grabix.db").exists())
            self.assertTrue((preferred_root / "grabix_settings.json").exists())
            self.assertTrue((preferred_root / "logs" / "backend.log").exists())

    def test_storage_layout_falls_back_to_legacy_root_when_preferred_root_is_invalid(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            legacy_root = temp_root / "legacy"
            legacy_root.mkdir(parents=True, exist_ok=True)
            blocked_target = temp_root / "blocked-root"
            blocked_target.write_text("not-a-directory", encoding="utf-8")

            with mock.patch.object(runtime_config, "LEGACY_DOWNLOAD_ROOT", legacy_root), \
                 mock.patch.dict(os.environ, {runtime_config.APP_STATE_ROOT_ENV: str(blocked_target)}, clear=False):
                runtime_config.reset_runtime_config_caches()
                layout = runtime_config.storage_layout()

            self.assertEqual(Path(layout["active_root"]), legacy_root.resolve())
            self.assertEqual(layout["migration"]["status"], "failed")
            self.assertTrue(layout["migration"]["used_fallback"])
            self.assertTrue(layout["migration"]["error"])

    def test_settings_backup_is_used_when_primary_file_is_corrupt(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            settings_path = temp_root / "grabix_settings.json"

            with mock.patch.object(db_helpers, "SETTINGS_PATH", str(settings_path)), \
                 mock.patch.object(db_helpers, "DOWNLOAD_DIR", str(temp_root / "downloads")):
                db_helpers.save_settings_to_disk({"theme": "dark", "download_folder": str(temp_root / "downloads")})
                db_helpers.save_settings_to_disk({"theme": "light", "download_folder": str(temp_root / "downloads")})

                settings_path.write_text("{invalid json", encoding="utf-8")
                restored = db_helpers.load_settings()

            self.assertEqual(restored["theme"], "dark")
            self.assertTrue((temp_root / "grabix_settings.json.bak").exists())


if __name__ == "__main__":
    unittest.main()
