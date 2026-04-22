# backend/main.py
# ─────────────────────────────────────────────────────────────────────────────
# Compatibility shim — keeps `import main` working from tests and any external
# caller while the real implementation lives in backend/core/main.py
#
# DO NOT put logic here. This file is only a re-export bridge.
# ─────────────────────────────────────────────────────────────────────────────

from core.main import *          # re-export everything (routes, lifespan, etc.)
from core.main import app        # explicit re-export so `main.app` works in tests

# `import *` silently skips names that start with `_`, so library_helpers.py
# (which does `import main as _m` and then `_m._infer_download_category` etc.)
# would crash at runtime. Re-export them explicitly here.
from core.download_helpers import _infer_download_category, _infer_library_display_layout, _normalize_tags_csv  # noqa: F401

# _is_internal_managed_file lives in anime/resolver.py; pull it in so the shim
# exposes it as `main._is_internal_managed_file`.
from anime.resolver import _is_internal_managed_file  # noqa: F401
from core.cache_ops import _sqlite_cache_get, _sqlite_cache_set  # noqa: F401

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
