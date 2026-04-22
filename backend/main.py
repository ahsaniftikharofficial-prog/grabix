# backend/main.py
# ─────────────────────────────────────────────────────────────────────────────
# Compatibility shim — keeps `import main` working from tests and any external
# caller while the real implementation lives in backend/core/main.py
#
# DO NOT put logic here. This file is only a re-export bridge.
# ─────────────────────────────────────────────────────────────────────────────

from core.main import *          # re-export everything (routes, lifespan, etc.)
from core.main import app        # explicit re-export so `main.app` works in tests
