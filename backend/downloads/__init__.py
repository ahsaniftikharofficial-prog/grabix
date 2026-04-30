"""
downloads/__init__.py
Exposes router and register_handlers for main.py.
"""
from .engine import router, register_handlers, init

__all__ = ["router", "register_handlers", "init"]
