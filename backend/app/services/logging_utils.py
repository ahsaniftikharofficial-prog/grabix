import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

LOG_DIR = Path.home() / "Downloads" / "GRABIX" / "logs"
MAX_LOG_BYTES = 1_000_000
BACKUP_COUNT = 3
_CONFIGURED = False


class JsonLineFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "service": getattr(record, "service", record.name),
            "event": getattr(record, "event", record.name),
            "correlation_id": getattr(record, "correlation_id", ""),
            "message": record.getMessage(),
            "details": getattr(record, "details", {}),
        }
        return json.dumps(payload, ensure_ascii=True, default=str)


def initialize_logging() -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    _CONFIGURED = True


def get_logger(service: str) -> logging.Logger:
    initialize_logging()
    logger = logging.getLogger(f"grabix.{service}")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        handler = RotatingFileHandler(
            LOG_DIR / f"{service}.log",
            maxBytes=MAX_LOG_BYTES,
            backupCount=BACKUP_COUNT,
            encoding="utf-8",
        )
        handler.setFormatter(JsonLineFormatter())
        logger.addHandler(handler)
    return logger


def log_event(
    logger: logging.Logger,
    level: int,
    *,
    event: str,
    message: str,
    correlation_id: str = "",
    details: dict[str, Any] | None = None,
) -> None:
    logger.log(
        level,
        message,
        extra={
            "service": logger.name.replace("grabix.", "", 1),
            "event": event,
            "correlation_id": correlation_id,
            "details": details or {},
        },
    )


def backend_log_path() -> str:
    initialize_logging()
    return str((LOG_DIR / "backend.log").resolve())


def read_recent_log_events(limit: int = 30, levels: set[str] | None = None) -> list[dict[str, Any]]:
    initialize_logging()
    events: list[dict[str, Any]] = []
    for path in sorted(LOG_DIR.glob("*.log")):
        try:
            with path.open("r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if levels and str(payload.get("level", "")).upper() not in levels:
                        continue
                    payload["log_file"] = path.name
                    events.append(payload)
        except OSError:
            continue

    events.sort(key=lambda item: str(item.get("timestamp", "")))
    return events[-limit:]
