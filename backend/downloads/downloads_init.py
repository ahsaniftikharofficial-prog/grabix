"""
downloads/ — Download engine package for GRABIX.

Exports:
  router             — empty APIRouter (main.py includes it; all actual routes
                       are in app/routes/downloads.py which imports engine directly)
  register_handlers  — called once at startup by run_server()
"""
from fastapi import APIRouter

from .engine import register_handlers, ensure_runtime_bootstrap, recover_download_jobs

# Empty router — all real routes live in app/routes/downloads.py.
# main.py includes this to satisfy the include_router call without error.
router = APIRouter()

__all__ = ["router", "register_handlers", "ensure_runtime_bootstrap", "recover_download_jobs"]
