"""
core/network_monitor.py
Network connectivity monitor: pings 8.8.8.8 every 15s.
Wi-Fi drop  → pauses all active downloads.
Wi-Fi back  → auto-resumes them.
Extracted from main.py (Phase 2 split).
"""
import socket
import threading
import time

from app.services.logging_utils import get_logger
from downloads.engine import _persist_download_record, _start_download_thread

# ---------------------------------------------------------------------------
# Module-level state injected by main.py via init()
# ---------------------------------------------------------------------------
_downloads: dict = {}
_download_controls: dict = {}
_backend_logger = get_logger("backend")

_network_was_online: bool = True
_network_monitor_started: bool = False


def init(downloads: dict, download_controls: dict, backend_logger=None) -> None:
    """Called once by main.py after runtime_state is created."""
    global _downloads, _download_controls, _backend_logger
    _downloads = downloads
    _download_controls = download_controls
    if backend_logger is not None:
        _backend_logger = backend_logger


# ---------------------------------------------------------------------------
# Network helpers
# ---------------------------------------------------------------------------

def _check_network() -> bool:
    try:
        socket.setdefaulttimeout(5)
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(("8.8.8.8", 53))
        s.close()
        return True
    except Exception:
        return False


def _network_monitor_worker() -> None:
    global _network_was_online
    while True:
        try:
            time.sleep(15)
            online = _check_network()

            if not online and _network_was_online:
                _network_was_online = False
                for dl_id, item in list(_downloads.items()):
                    if item.get("status") in {"downloading", "queued"}:
                        ctrl = _download_controls.get(dl_id)
                        if ctrl and item.get("can_pause"):
                            ctrl["pause"].set()
                            item["paused_from"] = item.get("status", "downloading")
                            item["status"] = "paused"
                            item["stage_label"] = "Waiting for network..."
                            item["error"] = ""
                            _persist_download_record(dl_id, force=True)

            elif online and not _network_was_online:
                _network_was_online = True
                for dl_id, item in list(_downloads.items()):
                    if (
                        item.get("status") == "paused"
                        and item.get("stage_label", "") == "Waiting for network..."
                    ):
                        ctrl = _download_controls.get(dl_id)
                        if ctrl:
                            ctrl["pause"].clear()
                            item["status"] = item.pop("paused_from", "downloading")
                            item["stage_label"] = "Reconnecting..."
                            item["error"] = ""
                            _persist_download_record(dl_id, force=True)
                            _start_download_thread(dl_id)

        except Exception as _exc:
            _backend_logger.warning(
                "_network_monitor_worker iteration failed: %s", _exc, exc_info=False
            )


def _start_network_monitor() -> None:
    global _network_monitor_started
    if _network_monitor_started:
        return
    _network_monitor_started = True
    threading.Thread(
        target=_network_monitor_worker, daemon=True, name="network-monitor"
    ).start()
