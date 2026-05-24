"""
shared/constants.py — Constants shared across multiple GRABIX modules.

Any value that appears in more than one file belongs here.
No internal GRABIX imports — safe to import from anywhere.
"""

# ── API ───────────────────────────────────────────────────────────────────────

API_VERSION = "1.0"

# ── Download status values ────────────────────────────────────────────────────
# These match the exact strings used in engine.py and db_helpers.py.

STATUS_QUEUED     = "queued"
STATUS_DOWNLOADING = "downloading"
STATUS_PROCESSING  = "processing"
STATUS_PAUSED     = "paused"
STATUS_DONE       = "done"
STATUS_ERROR      = "error"
STATUS_CANCELED   = "canceled"

# ── Default values ────────────────────────────────────────────────────────────

DEFAULT_BACKEND_PORT    = 8000
DEFAULT_DOWNLOAD_TIMEOUT = 30
DEFAULT_MAX_LOG_BYTES   = 1_000_000
DEFAULT_LOG_BACKUP_COUNT = 3
