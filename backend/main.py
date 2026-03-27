from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp, os, uuid, sqlite3, shutil, threading, subprocess, time, json, re
from pathlib import Path
from datetime import datetime
from urllib.parse import urljoin
from urllib.request import Request, urlopen

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

DOWNLOAD_DIR = str(Path.home() / "Downloads" / "GRABIX")
DB_PATH = str(Path.home() / "Downloads" / "GRABIX" / "grabix.db")
SETTINGS_PATH = str(Path.home() / "Downloads" / "GRABIX" / "grabix_settings.json")

# Always create the download directory before any DB or file operations
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# In-memory progress store
downloads: dict = {}
download_controls: dict = {}
FFMPEG_PATH = shutil.which("ffmpeg")


def _strip_ansi(s: str) -> str:
    """Remove ANSI terminal color codes from a string."""
    return re.sub(r"\x1b\[[0-9;]*[mGKH]", "", s or "").strip()


def has_ffmpeg() -> bool:
    return FFMPEG_PATH is not None


def _format_bytes(num: float | int | None) -> str:
    if not num:
        return ""
    value = float(num)
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    if idx == 0:
        return f"{int(value)} {units[idx]}"
    return f"{value:.1f} {units[idx]}"


def _format_eta(seconds: float | int | None) -> str:
    if seconds is None:
        return ""
    safe = max(0, int(seconds))
    mins, secs = divmod(safe, 60)
    hours, mins = divmod(mins, 60)
    if hours:
        return f"{hours}h {mins}m"
    if mins:
        return f"{mins}m {secs}s"
    return f"{secs}s"


# ── DB Setup ──────────────────────────────────────────────────────────────────
def get_db_connection():
    """Return a new sqlite3 connection with row_factory set."""
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    """Create all required tables if they don't exist."""
    try:
        con = get_db_connection()
        con.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                url TEXT,
                title TEXT,
                thumbnail TEXT,
                channel TEXT,
                duration INTEGER,
                dl_type TEXT,
                file_path TEXT,
                status TEXT,
                created_at TEXT
            )
        """)
        con.commit()
        con.close()
        print("[GRABIX] Database initialized successfully.")
    except Exception as e:
        print(f"[GRABIX] DB init error: {e}")


init_db()


def db_insert(row: dict):
    try:
        con = get_db_connection()
        con.execute("INSERT OR REPLACE INTO history VALUES (?,?,?,?,?,?,?,?,?,?)", (
            row["id"], row["url"], row["title"], row["thumbnail"],
            row["channel"], row["duration"], row["dl_type"],
            row["file_path"], row["status"], row["created_at"]
        ))
        con.commit()
        con.close()
    except Exception as e:
        print(f"[GRABIX] db_insert error: {e}")


def db_update_status(dl_id: str, status: str, file_path: str = ""):
    try:
        con = get_db_connection()
        con.execute("UPDATE history SET status=?, file_path=? WHERE id=?", (status, file_path, dl_id))
        con.commit()
        con.close()
    except Exception as e:
        print(f"[GRABIX] db_update_status error: {e}")


# ── Settings ──────────────────────────────────────────────────────────────────
DEFAULT_SETTINGS = {
    "theme": "dark",
    "auto_fetch": True,
    "notifications": True,
    "default_format": "mp4",
    "default_quality": "1080p",
    "download_folder": DOWNLOAD_DIR,
}


def load_settings() -> dict:
    try:
        if os.path.exists(SETTINGS_PATH):
            with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                # Merge with defaults so any new keys are always present
                return {**DEFAULT_SETTINGS, **saved}
    except Exception as e:
        print(f"[GRABIX] load_settings error: {e}")
    return DEFAULT_SETTINGS.copy()


def save_settings_to_disk(data: dict):
    try:
        current = load_settings()
        current.update(data)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
    except Exception as e:
        print(f"[GRABIX] save_settings error: {e}")


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/")
def home():
    return {"status": "GRABIX Backend Running"}


def _extract_iframe_src(html: str) -> str:
    content = html or ""
    iframe_match = re.search(r'<iframe[^>]+src=["\']([^"\']+)["\']', content, re.IGNORECASE)
    if iframe_match:
        return iframe_match.group(1).strip()

    scripted_match = re.search(r"src:\s*['\"]([^'\"]+)['\"]", content, re.IGNORECASE)
    if scripted_match:
        return scripted_match.group(1).strip()

    return ""


def _resolve_embed_target(url: str, max_depth: int = 3) -> str:
    current = (url or "").strip()
    if not current:
        return ""

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": current,
    }

    for _ in range(max_depth):
        req = Request(current, headers=headers)
        with urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        iframe_src = _extract_iframe_src(html)
        if not iframe_src:
            return current

        next_url = urljoin(current, iframe_src)
        if next_url == current:
            return current

        if any(host in next_url for host in ("vidsrc.to", "vsembed.ru")):
            current = next_url
            continue

        return next_url

    return current


@app.get("/resolve-embed")
def resolve_embed(url: str):
    try:
        resolved = _resolve_embed_target(url)
        return {"url": resolved or url}
    except Exception as e:
        return {"url": url, "error": str(e)}


@app.get("/check-link")
def check_link(url: str):
    opts = {"quiet": True, "no_warnings": True, "no_color": True, "noplaylist": True, "skip_download": True, "socket_timeout": 8}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                "valid": True,
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail", ""),
                "duration_seconds": info.get("duration", 0),
                "uploader": info.get("channel") or info.get("uploader", ""),
                "formats": _get_formats(info),
            }
    except Exception as e:
        return {"valid": False, "error": str(e)}


# ── Quality helpers ───────────────────────────────────────────────────────────
# Standard quality tiers: height → display label
_HEIGHT_LABELS = {
    144: "144p",
    240: "240p",
    360: "360p",
    480: "480p",
    720: "720p",
    1080: "1080p",
    1440: "2K",
    2160: "4K",
}


def _height_to_label(h: int) -> str:
    """Snap an arbitrary pixel height to the nearest standard label."""
    if h in _HEIGHT_LABELS:
        return _HEIGHT_LABELS[h]
    tiers = sorted(_HEIGHT_LABELS.keys())
    closest = min(tiers, key=lambda t: abs(t - h))
    return _HEIGHT_LABELS[closest]


def _get_formats(info: dict) -> list[str]:
    """
    Return a sorted list of quality label strings, e.g. ["4K","2K","1080p","720p","480p"].
    Only heights from REAL, downloadable video streams are included.
    Audio-only tracks, storyboards, and streams without a video codec are excluded.
    """
    seen_heights: set[int] = set()

    for f in (info.get("formats") or []):
        h = f.get("height")
        if not h or not isinstance(h, int) or h <= 0:
            continue
        # Skip audio-only streams (vcodec="none" means no video track)
        if f.get("vcodec", "none") == "none":
            continue
        # Skip storyboard / image tracks (fps < 1 or explicitly marked)
        fps = f.get("fps")
        if fps is not None and fps < 1:
            continue
        # Skip formats with no download URL
        if not f.get("url") and not f.get("fragment_base_url") and not f.get("fragments"):
            continue
        seen_heights.add(h)

    if not seen_heights:
        # Fallback when format list is unavailable (e.g. live streams, private videos)
        return ["1080p", "720p", "480p", "360p"]

    # Snap each real height to a standard label, keep the tallest representative per label
    label_to_max_height: dict[str, int] = {}
    for h in seen_heights:
        label = _height_to_label(h)
        if label not in label_to_max_height or h > label_to_max_height[label]:
            label_to_max_height[label] = h

    # Sort descending by height
    ordered = sorted(label_to_max_height.items(), key=lambda x: x[1], reverse=True)
    return [label for label, _ in ordered]


def _label_to_max_height(label: str) -> int:
    """Convert a quality label back to a pixel height for yt-dlp format selection."""
    reverse = {v: k for k, v in _HEIGHT_LABELS.items()}
    return reverse.get(label, 1080)


def _build_video_format_selector(quality: str) -> str:
    h = _label_to_max_height(quality)
    if has_ffmpeg():
        return (
            f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]"
            f"/bestvideo[height<={h}]+bestaudio"
            f"/best[height<={h}][ext=mp4]"
            f"/best[height<={h}]"
            f"/best"
        )
    return f"best[height<={h}][ext=mp4]/best[height<={h}]/best"


# ── Download record helpers ───────────────────────────────────────────────────
def _create_download_record(dl_id: str, title: str = "", params: dict | None = None) -> dict:
    downloads[dl_id] = {
        "id": dl_id,
        "status": "queued",
        "percent": 0,
        "speed": "",
        "eta": "",
        "downloaded": "",
        "total": "",
        "size": "",
        "title": title,
        "error": "",
        "file_path": "",
        "folder": DOWNLOAD_DIR,
        "created_at": datetime.now().isoformat(),
        "params": params or {},
    }
    download_controls[dl_id] = {
        "pause": threading.Event(),
        "cancel": threading.Event(),
        "thread": None,
    }
    return downloads[dl_id]


def _public_download(d: dict) -> dict:
    return {
        "id": d.get("id"),
        "status": d.get("status"),
        "percent": d.get("percent", 0),
        "speed": d.get("speed", ""),
        "eta": d.get("eta", ""),
        "downloaded": d.get("downloaded", ""),
        "total": d.get("total", ""),
        "size": d.get("size", ""),
        "title": d.get("title", ""),
        "error": d.get("error", ""),
        "file_path": d.get("file_path", ""),
        "folder": d.get("folder", DOWNLOAD_DIR),
        "created_at": d.get("created_at", ""),
        "dl_type": (d.get("params") or {}).get("dl_type", ""),
    }


def _start_download_thread(dl_id: str):
    params = downloads[dl_id]["params"]
    worker = threading.Thread(
        target=_download_task,
        args=(
            dl_id,
            params["url"],
            params["dl_type"],
            params["quality"],
            params["audio_format"],
            params["audio_quality"],
            params["subtitle_lang"],
            params["thumbnail_format"],
            params["trim_start"],
            params["trim_end"],
            params["trim_enabled"],
            params.get("use_cpu", True),
        ),
        daemon=True,
    )
    download_controls[dl_id]["thread"] = worker
    worker.start()


# FIX 3: Changed from POST to GET — frontend calls this as a plain fetch() GET
@app.get("/download")
def start_download(
    url: str,
    dl_type: str = "video",
    quality: str = "best",
    audio_format: str = "mp3",
    audio_quality: str = "192",
    subtitle_lang: str = "en",
    thumbnail_format: str = "jpg",
    trim_start: float = 0,
    trim_end: float = 0,
    trim_enabled: bool = False,
    use_cpu: bool = True,
):
    dl_id = str(uuid.uuid4())
    params = {
        "url": url,
        "dl_type": dl_type,
        "quality": quality,
        "audio_format": audio_format,
        "audio_quality": audio_quality,
        "subtitle_lang": subtitle_lang,
        "thumbnail_format": thumbnail_format,
        "trim_start": trim_start,
        "trim_end": trim_end,
        "trim_enabled": trim_enabled,
        "use_cpu": use_cpu,
    }
    _create_download_record(dl_id, params=params)

    # Quick metadata fetch for history DB — non-blocking, errors are swallowed
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True, "noplaylist": True}) as ydl:
            info = ydl.extract_info(url, download=False)
            meta = {
                "id": dl_id, "url": url,
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail", ""),
                "channel": info.get("channel") or info.get("uploader", ""),
                "duration": info.get("duration", 0),
                "dl_type": dl_type, "file_path": "",
                "status": "queued",
                "created_at": datetime.now().isoformat(),
            }
            downloads[dl_id]["title"] = meta["title"]
            db_insert(meta)
    except Exception as e:
        print(f"[GRABIX] metadata fetch (non-fatal): {e}")

    _start_download_thread(dl_id)
    # Return both "task_id" and "id" so any frontend variant works
    return {"task_id": dl_id, "id": dl_id, "folder": DOWNLOAD_DIR}


# FIX 1: This is the correct endpoint name the frontend polls
@app.get("/download-status/{dl_id}")
def download_status(dl_id: str):
    item = downloads.get(dl_id)
    return _public_download(item) if item else {"status": "not_found"}


# Keep /progress/{dl_id} as an alias so nothing breaks
@app.get("/progress/{dl_id}")
def progress_alias(dl_id: str):
    return download_status(dl_id)


@app.get("/downloads")
def list_downloads():
    ordered = sorted(downloads.values(), key=lambda item: item.get("created_at", ""), reverse=True)
    return [_public_download(item) for item in ordered]


# FIX 2 + FIX 3 (Library): Proper error handling so "no such table" never reaches the UI
@app.get("/history")
def get_history():
    try:
        # Re-run init in case the DB file was deleted after startup
        init_db()
        con = get_db_connection()
        rows = con.execute("SELECT * FROM history ORDER BY created_at DESC LIMIT 100").fetchall()
        con.close()
        return [dict(row) for row in rows]
    except Exception as e:
        print(f"[GRABIX] get_history error: {e}")
        return []


@app.post("/open-download-folder")
def open_download_folder(path: str = ""):
    # If the specific file doesn't exist, fall back to the DOWNLOAD_DIR folder
    target = Path(path) if path else Path(DOWNLOAD_DIR)
    if not target.exists():
        target = Path(DOWNLOAD_DIR)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Download folder not found")

    try:
        if os.name == "nt":
            if target.is_file():
                # Highlight the specific file in Explorer
                subprocess.Popen(["explorer", "/select,", str(target)])
            else:
                # Open the folder
                subprocess.Popen(["explorer", str(target)])
        else:
            raise HTTPException(status_code=501, detail="Open folder is currently implemented for Windows only")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"opened": str(target)}


@app.post("/downloads/{dl_id}/action")
def download_action(dl_id: str, action: str):
    if dl_id not in downloads:
        raise HTTPException(status_code=404, detail="Download not found")

    item = downloads[dl_id]
    controls = download_controls.get(dl_id)
    if controls is None:
        raise HTTPException(status_code=404, detail="Download controls not found")

    if action == "pause":
        controls["pause"].set()
        if item["status"] == "downloading":
            item["status"] = "paused"
            db_update_status(dl_id, "paused", item.get("file_path", ""))
    elif action == "resume":
        controls["pause"].clear()
        if item["status"] == "paused":
            item["status"] = "downloading"
            db_update_status(dl_id, "downloading", item.get("file_path", ""))
    elif action == "cancel":
        controls["cancel"].set()
        item["status"] = "canceling"
    elif action == "retry":
        if item["status"] not in {"failed", "canceled"}:
            raise HTTPException(status_code=400, detail="Only failed or canceled downloads can be retried")
        controls["pause"].clear()
        controls["cancel"].clear()
        item.update({
            "status": "queued", "percent": 0, "speed": "", "eta": "",
            "downloaded": "", "total": "", "size": "", "error": "", "file_path": "",
        })
        db_update_status(dl_id, "queued")
        _start_download_thread(dl_id)
    else:
        raise HTTPException(status_code=400, detail="Unsupported action")

    return _public_download(item)


@app.post("/downloads/stop-all")
def stop_all_downloads():
    for dl_id, item in downloads.items():
        if item["status"] in {"queued", "downloading", "paused", "canceling"}:
            controls = download_controls.get(dl_id)
            if controls:
                controls["cancel"].set()
            item["status"] = "canceling"
    return {"status": "stopping"}


# ── Settings routes ───────────────────────────────────────────────────────────
@app.get("/settings")
def get_settings():
    return load_settings()


@app.post("/settings")
def update_settings(data: dict):
    save_settings_to_disk(data)
    return load_settings()


# ── Download Task ─────────────────────────────────────────────────────────────
def _resolve_final_file(raw_path: str, download_dir: str) -> str:
    """
    After yt-dlp finishes, return the path to the real output file.
    The progress hook often stores a .part temp filename or a pre-merge filename.
    """
    if raw_path:
        p = Path(raw_path)
        # .part file: yt-dlp renames it on completion, try without suffix
        if p.suffix == ".part":
            candidate = p.with_suffix("")
            if candidate.exists() and candidate.is_file():
                return str(candidate)
        elif p.exists() and p.is_file():
            return str(p)

    # Fallback: find the most recently modified non-.part file in DOWNLOAD_DIR
    try:
        files = [f for f in Path(download_dir).iterdir()
                 if f.is_file() and f.suffix != ".part"]
        if files:
            newest = max(files, key=lambda f: f.stat().st_mtime)
            return str(newest)
    except Exception:
        pass

    return download_dir


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — ADDITIONS TO backend/main.py
#
# Paste these NEW routes and helpers into your existing main.py.
# Add them BEFORE the final `_download_task` function at the bottom.
# Do NOT remove or replace anything already in main.py.
# ─────────────────────────────────────────────────────────────────────────────

import os
from pathlib import Path

# ── Phase 3: DB migration — add tags + category columns if missing ────────────
def migrate_db():
    """Add Phase 3 columns to the history table if they don't exist yet."""
    try:
        con = get_db_connection()
        cols = [row[1] for row in con.execute("PRAGMA table_info(history)").fetchall()]
        if "tags" not in cols:
            con.execute("ALTER TABLE history ADD COLUMN tags TEXT DEFAULT ''")
        if "category" not in cols:
            con.execute("ALTER TABLE history ADD COLUMN category TEXT DEFAULT ''")
        if "file_size" not in cols:
            con.execute("ALTER TABLE history ADD COLUMN file_size INTEGER DEFAULT 0")
        con.commit()
        con.close()
        print("[GRABIX] Phase 3 DB migration done.")
    except Exception as e:
        print(f"[GRABIX] migrate_db error: {e}")

migrate_db()


# ── Helper: get real file size from disk ─────────────────────────────────────
def _get_file_size(file_path: str) -> int:
    try:
        p = Path(file_path)
        if p.exists() and p.is_file():
            return p.stat().st_size
    except Exception:
        pass
    return 0


def _format_bytes_int(num: int) -> str:
    if not num:
        return "0 B"
    value = float(num)
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    if idx == 0:
        return f"{int(value)} {units[idx]}"
    return f"{value:.1f} {units[idx]}"


# ── Phase 3: Enriched history endpoint ───────────────────────────────────────
@app.get("/history/full")
def get_history_full():
    """
    Returns history with real file sizes read from disk.
    Also updates the DB file_size column if it hasn't been set yet.
    """
    try:
        init_db()
        migrate_db()
        con = get_db_connection()
        rows = con.execute("SELECT * FROM history ORDER BY created_at DESC LIMIT 500").fetchall()
        result = []
        for row in rows:
            item = dict(row)
            size_bytes = item.get("file_size") or 0
            # If no size stored, read from disk
            if not size_bytes and item.get("file_path"):
                size_bytes = _get_file_size(item["file_path"])
                if size_bytes:
                    con.execute("UPDATE history SET file_size=? WHERE id=?", (size_bytes, item["id"]))
            item["file_size"] = size_bytes
            item["file_size_label"] = _format_bytes_int(size_bytes)
            result.append(item)
        con.commit()
        con.close()
        return result
    except Exception as e:
        print(f"[GRABIX] get_history_full error: {e}")
        return []


# ── Phase 3: Delete a file from disk and history DB ──────────────────────────
@app.delete("/history/{item_id}")
def delete_history_item(item_id: str, delete_file: bool = True):
    """
    Remove a history entry. If delete_file=true (default), also deletes the
    actual file from disk.
    """
    try:
        con = get_db_connection()
        row = con.execute("SELECT file_path FROM history WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        file_path = row["file_path"]
        con.execute("DELETE FROM history WHERE id=?", (item_id,))
        con.commit()
        con.close()

        deleted_file = False
        if delete_file and file_path:
            try:
                p = Path(file_path)
                if p.exists() and p.is_file():
                    p.unlink()
                    deleted_file = True
            except Exception as fe:
                print(f"[GRABIX] delete file error: {fe}")

        return {"deleted": True, "file_deleted": deleted_file}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Phase 3: Update tags and category for a history item ─────────────────────
@app.patch("/history/{item_id}")
def update_history_item(item_id: str, tags: str = "", category: str = ""):
    """Update the tags and category of a history entry."""
    try:
        con = get_db_connection()
        con.execute(
            "UPDATE history SET tags=?, category=? WHERE id=?",
            (tags, category, item_id)
        )
        con.commit()
        row = con.execute("SELECT * FROM history WHERE id=?", (item_id,)).fetchone()
        con.close()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        return dict(row)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Phase 3: Storage stats ────────────────────────────────────────────────────
@app.get("/storage/stats")
def get_storage_stats():
    """
    Returns total disk usage and per-type breakdown from the history DB.
    Also scans DOWNLOAD_DIR for any files not in the DB.
    """
    try:
        init_db()
        migrate_db()
        con = get_db_connection()
        rows = con.execute("SELECT dl_type, file_path, file_size FROM history").fetchall()
        con.close()

        by_type: dict[str, int] = {"video": 0, "audio": 0, "thumbnail": 0, "subtitle": 0, "other": 0}
        tracked_files: set[str] = set()
        total_bytes = 0

        for row in rows:
            fp = row["file_path"] or ""
            size = row["file_size"] or 0
            if fp:
                # Always read from disk for accuracy
                disk_size = _get_file_size(fp)
                size = disk_size if disk_size else size
                tracked_files.add(fp)
            t = row["dl_type"] or "other"
            if t not in by_type:
                t = "other"
            by_type[t] += size
            total_bytes += size

        # Scan for untracked files in DOWNLOAD_DIR
        untracked_bytes = 0
        untracked_count = 0
        try:
            for f in Path(DOWNLOAD_DIR).iterdir():
                if f.is_file() and str(f) not in tracked_files:
                    sz = f.stat().st_size
                    untracked_bytes += sz
                    untracked_count += 1
        except Exception:
            pass

        # Disk usage of the whole DOWNLOAD_DIR
        folder_total = 0
        try:
            for f in Path(DOWNLOAD_DIR).rglob("*"):
                if f.is_file():
                    try:
                        folder_total += f.stat().st_size
                    except Exception:
                        pass
        except Exception:
            pass

        return {
            "total_bytes": total_bytes,
            "total_label": _format_bytes_int(total_bytes),
            "folder_total_bytes": folder_total,
            "folder_total_label": _format_bytes_int(folder_total),
            "by_type": {k: {"bytes": v, "label": _format_bytes_int(v)} for k, v in by_type.items()},
            "untracked_bytes": untracked_bytes,
            "untracked_count": untracked_count,
            "download_dir": DOWNLOAD_DIR,
        }
    except Exception as e:
        print(f"[GRABIX] storage_stats error: {e}")
        return {"total_bytes": 0, "total_label": "0 B", "folder_total_bytes": 0,
                "folder_total_label": "0 B", "by_type": {}, "untracked_bytes": 0,
                "untracked_count": 0, "download_dir": DOWNLOAD_DIR}


# ── Phase 3: Clear all history (DB only, optionally delete files) ─────────────
@app.delete("/history")
def clear_history(delete_files: bool = False):
    """Delete all history entries. Optionally delete the actual files too."""
    try:
        con = get_db_connection()
        if delete_files:
            rows = con.execute("SELECT file_path FROM history").fetchall()
            for row in rows:
                fp = row["file_path"]
                if fp:
                    try:
                        p = Path(fp)
                        if p.exists() and p.is_file():
                            p.unlink()
                    except Exception:
                        pass
        con.execute("DELETE FROM history")
        con.commit()
        con.close()
        return {"cleared": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Phase 3: Organize files into subfolders by type ──────────────────────────
@app.post("/library/organize")
def organize_library():
    """
    Moves downloaded files into subfolders: Videos/, Audio/, Thumbnails/, Subtitles/
    Updates file_path in the DB after moving.
    """
    type_folders = {
        "video":     "Videos",
        "audio":     "Audio",
        "thumbnail": "Thumbnails",
        "subtitle":  "Subtitles",
    }
    moved = 0
    errors = []

    try:
        con = get_db_connection()
        rows = con.execute("SELECT id, dl_type, file_path FROM history").fetchall()

        for row in rows:
            fp = row["file_path"]
            dl_type = row["dl_type"] or "video"
            if not fp:
                continue
            p = Path(fp)
            if not p.exists() or not p.is_file():
                continue

            subfolder = type_folders.get(dl_type, "Other")
            dest_dir = Path(DOWNLOAD_DIR) / subfolder
            dest_dir.mkdir(exist_ok=True)
            dest = dest_dir / p.name

            # Don't move if already in the right folder
            if p.parent == dest_dir:
                continue

            # Avoid overwrite collisions
            if dest.exists():
                stem = p.stem
                suffix = p.suffix
                counter = 1
                while dest.exists():
                    dest = dest_dir / f"{stem}_{counter}{suffix}"
                    counter += 1

            try:
                shutil.move(str(p), str(dest))
                con.execute("UPDATE history SET file_path=? WHERE id=?", (str(dest), row["id"]))
                moved += 1
            except Exception as e:
                errors.append({"file": str(p), "error": str(e)})

        con.commit()
        con.close()
        return {"moved": moved, "errors": errors}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _download_task(dl_id, url, dl_type, quality, audio_format, audio_quality,
                   subtitle_lang, thumbnail_format, trim_start, trim_end, trim_enabled, use_cpu=True):
    downloads[dl_id]["status"] = "downloading"
    downloads[dl_id]["error"] = ""
    controls = download_controls[dl_id]

    def progress_hook(d):
        while controls["pause"].is_set() and not controls["cancel"].is_set():
            time.sleep(0.2)

        if controls["cancel"].is_set():
            raise RuntimeError("Download canceled")

        if d["status"] == "downloading":
            downloaded_bytes = d.get("downloaded_bytes") or 0
            total_bytes = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            pct = round((downloaded_bytes / total_bytes) * 100, 1) if total_bytes else 0
            raw_speed = d.get("speed")
            speed = _strip_ansi(d.get("_speed_str", ""))
            if not speed and raw_speed:
                speed = f"{_format_bytes(raw_speed)}/s"
            eta = _strip_ansi(d.get("_eta_str", "")) or _format_eta(d.get("eta"))
            downloads[dl_id].update({
                "percent": pct,
                "speed": speed,
                "eta": eta,
                "downloaded": _format_bytes(downloaded_bytes),
                "total": _format_bytes(total_bytes),
                "size": _format_bytes(total_bytes or downloaded_bytes),
                "file_path": d.get("filename", downloads[dl_id].get("file_path", "")),
            })
        elif d["status"] == "finished":
            downloads[dl_id]["percent"] = 100
            downloads[dl_id]["eta"] = "0s"
            downloads[dl_id]["speed"] = ""
            downloads[dl_id]["downloaded"] = downloads[dl_id].get("total") or downloads[dl_id].get("downloaded", "")
            downloads[dl_id]["size"] = downloads[dl_id].get("total") or downloads[dl_id].get("size", "")
            downloads[dl_id]["file_path"] = d.get("filename", downloads[dl_id].get("file_path", ""))

    template = f"{DOWNLOAD_DIR}/%(title)s.%(ext)s"
    opts: dict = {"outtmpl": template, "noplaylist": True, "progress_hooks": [progress_hook], "continuedl": True}

    try:
        if dl_type == "video":
            opts["format"] = _build_video_format_selector(quality)
            if trim_enabled and trim_end > trim_start:
                # Always set the download range — this is what actually restricts what yt-dlp fetches
                opts["download_ranges"] = yt_dlp.utils.download_range_func(
                    None, [(float(trim_start), float(trim_end))]
                )
                if use_cpu:
                    # Precise cut: re-encode with FFmpeg for frame-accurate trim
                    if not has_ffmpeg():
                        raise RuntimeError("Precise trim (With CPU) requires FFmpeg. Switch to 'No CPU' mode or install FFmpeg.")
                    opts["force_keyframes_at_cuts"] = True
                else:
                    # Fast cut: no re-encode, trim aligns to nearest keyframe (±2s)
                    opts["force_keyframes_at_cuts"] = False

        elif dl_type == "audio":
            opts["format"] = "bestaudio/best"
            if has_ffmpeg():
                opts["postprocessors"] = [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": audio_format,
                    "preferredquality": audio_quality,
                }]

        elif dl_type == "thumbnail":
            opts["skip_download"] = True
            opts["writethumbnail"] = True
            if has_ffmpeg():
                opts["postprocessors"] = [{"key": "FFmpegThumbnailsConvertor", "format": thumbnail_format}]

        elif dl_type == "subtitle":
            opts["skip_download"] = True
            opts["writesubtitles"] = True
            opts["writeautomaticsub"] = True
            opts["subtitleslangs"] = [subtitle_lang]

        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        # Resolve real output file — progress hook stores temp/partial path,
        # after merge/postprocessing the final file may have a different name.
        raw_path = downloads[dl_id].get("file_path", "")
        file_path = _resolve_final_file(raw_path, DOWNLOAD_DIR)
        downloads[dl_id]["file_path"] = file_path
        downloads[dl_id]["status"] = "done"
        downloads[dl_id]["percent"] = 100
        db_update_status(dl_id, "done", file_path)

    except Exception as e:
        status = "canceled" if controls["cancel"].is_set() else "failed"
        downloads[dl_id]["status"] = status
        downloads[dl_id]["error"] = str(e)
        db_update_status(dl_id, status, downloads[dl_id].get("file_path", ""))
    finally:
        controls["pause"].clear()


# ═══════════════════════════════════════════════════════════════════════════════
# CONVERSION ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

# In-memory store for conversion jobs (same pattern as downloads)
conversions: dict = {}

def _create_conversion_record(job_id: str, input_path: str, output_format: str) -> dict:
    conversions[job_id] = {
        "id": job_id,
        "status": "queued",
        "percent": 0,
        "input_path": input_path,
        "output_path": "",
        "output_format": output_format,
        "error": "",
        "created_at": datetime.now().isoformat(),
    }
    return conversions[job_id]


def _conversion_task(job_id: str, input_path: str, output_format: str):
    """Run FFmpeg to convert input_path to output_format, updating conversions[job_id]."""
    job = conversions[job_id]
    job["status"] = "converting"
    job["percent"] = 5

    if not has_ffmpeg():
        job["status"] = "failed"
        job["error"] = "FFmpeg is not installed. Install FFmpeg and add it to PATH."
        return

    input_p = Path(input_path)
    if not input_p.exists():
        job["status"] = "failed"
        job["error"] = f"File not found: {input_path}"
        return

    output_path = str(input_p.with_suffix(f".{output_format}"))
    # Avoid overwriting the source file if same extension
    if output_path == input_path:
        stem = input_p.stem + "_converted"
        output_path = str(input_p.parent / f"{stem}.{output_format}")

    job["output_path"] = output_path

    # Build FFmpeg command. -y = overwrite without asking.
    cmd = [FFMPEG_PATH, "-y", "-i", input_path]

    # Format-specific encoding flags for quality/compatibility
    fmt = output_format.lower()
    if fmt == "mp4":
        cmd += ["-c:v", "libx264", "-crf", "23", "-preset", "fast", "-c:a", "aac", "-b:a", "192k"]
    elif fmt == "mp3":
        cmd += ["-vn", "-c:a", "libmp3lame", "-q:a", "2"]
    elif fmt == "m4a":
        cmd += ["-vn", "-c:a", "aac", "-b:a", "192k"]
    elif fmt == "opus":
        cmd += ["-vn", "-c:a", "libopus", "-b:a", "128k"]
    elif fmt == "flac":
        cmd += ["-vn", "-c:a", "flac"]
    elif fmt == "wav":
        cmd += ["-vn", "-c:a", "pcm_s16le"]
    elif fmt == "webm":
        cmd += ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-c:a", "libopus"]
    elif fmt == "mkv":
        cmd += ["-c:v", "copy", "-c:a", "copy"]
    elif fmt == "gif":
        cmd += ["-vf", "fps=10,scale=480:-1:flags=lanczos", "-loop", "0"]
    else:
        # Generic passthrough — let FFmpeg decide
        cmd += ["-c", "copy"]

    cmd.append(output_path)

    try:
        # Run FFmpeg. We parse stderr for progress via duration/time lines.
        proc = subprocess.Popen(
            cmd,
            stderr=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            universal_newlines=True,
            encoding="utf-8",
            errors="replace",
        )

        duration_secs: float = 0.0
        duration_re = re.compile(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)")
        time_re = re.compile(r"time=\s*(\d+):(\d+):(\d+\.\d+)")

        for line in proc.stderr:
            # Parse total duration once
            if not duration_secs:
                m = duration_re.search(line)
                if m:
                    h, mn, s = float(m.group(1)), float(m.group(2)), float(m.group(3))
                    duration_secs = h * 3600 + mn * 60 + s

            # Parse current time for progress
            m = time_re.search(line)
            if m and duration_secs:
                h, mn, s = float(m.group(1)), float(m.group(2)), float(m.group(3))
                current = h * 3600 + mn * 60 + s
                pct = min(99, round((current / duration_secs) * 100))
                job["percent"] = pct

        proc.wait()

        if proc.returncode != 0:
            job["status"] = "failed"
            job["error"] = "FFmpeg exited with an error. Check that the file is a valid media file."
            return

        job["percent"] = 100
        job["status"] = "done"
        job["output_path"] = output_path

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)


@app.post("/convert")
def start_conversion(input_path: str, output_format: str):
    """Start a background FFmpeg conversion job."""
    if not input_path or not output_format:
        raise HTTPException(status_code=400, detail="input_path and output_format are required")

    job_id = str(uuid.uuid4())
    _create_conversion_record(job_id, input_path, output_format)

    thread = threading.Thread(
        target=_conversion_task,
        args=(job_id, input_path, output_format),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "queued"}


@app.get("/convert-status/{job_id}")
def convert_status(job_id: str):
    job = conversions.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ═══════════════════════════════════════════════════════════════════════════════
# STORAGE STATS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/storage-stats")
def storage_stats():
    """Return total size + file count of the GRABIX downloads folder."""
    try:
        folder = Path(DOWNLOAD_DIR)
        if not folder.exists():
            return {"total_bytes": 0, "total_size": "0 B", "file_count": 0, "folder": DOWNLOAD_DIR}

        total = 0
        count = 0
        # Count all non-hidden, non-db files
        for f in folder.rglob("*"):
            if f.is_file() and not f.name.startswith(".") and f.suffix not in (".db", ".json"):
                total += f.stat().st_size
                count += 1

        return {
            "total_bytes": total,
            "total_size": _format_bytes(total),
            "file_count": count,
            "folder": DOWNLOAD_DIR,
        }
    except Exception as e:
        return {"total_bytes": 0, "total_size": "0 B", "file_count": 0, "folder": DOWNLOAD_DIR, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# HISTORY MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

@app.delete("/history/{item_id}")
def delete_history_item(item_id: str, delete_file: bool = False):
    """
    Remove a history record from the DB.
    If delete_file=true, also delete the file from disk.
    """
    try:
        con = get_db_connection()
        row = con.execute("SELECT file_path FROM history WHERE id=?", (item_id,)).fetchone()

        if not row:
            con.close()
            raise HTTPException(status_code=404, detail="History item not found")

        file_path = row["file_path"] or ""

        # Delete the physical file if requested and it exists
        deleted_file = False
        if delete_file and file_path:
            p = Path(file_path)
            if p.exists() and p.is_file():
                p.unlink()
                deleted_file = True

        # Always remove the DB record
        con.execute("DELETE FROM history WHERE id=?", (item_id,))
        con.commit()
        con.close()

        return {"deleted": item_id, "file_deleted": deleted_file, "file_path": file_path}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/history")
def clear_all_history(delete_files: bool = False):
    """Clear entire history. Optionally delete all files too."""
    try:
        con = get_db_connection()
        deleted_files = 0

        if delete_files:
            rows = con.execute("SELECT file_path FROM history WHERE file_path != ''").fetchall()
            for row in rows:
                p = Path(row["file_path"])
                if p.exists() and p.is_file():
                    try:
                        p.unlink()
                        deleted_files += 1
                    except Exception:
                        pass

        count = con.execute("SELECT COUNT(*) FROM history").fetchone()[0]
        con.execute("DELETE FROM history")
        con.commit()
        con.close()

        return {"cleared": count, "files_deleted": deleted_files}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ffmpeg-status")
def ffmpeg_status():
    """Check if FFmpeg is available."""
    return {"available": has_ffmpeg(), "path": FFMPEG_PATH or ""}
