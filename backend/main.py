from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp, os, uuid, sqlite3, shutil, threading, subprocess, time
from pathlib import Path
from datetime import datetime

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

DOWNLOAD_DIR = str(Path.home() / "Downloads" / "GRABIX")
DB_PATH = str(Path.home() / "Downloads" / "GRABIX" / "grabix.db")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# In-memory progress store
downloads: dict = {}
download_controls: dict = {}
FFMPEG_PATH = shutil.which("ffmpeg")


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
def init_db():
    con = sqlite3.connect(DB_PATH)
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
    con.commit(); con.close()

init_db()

def db_insert(row: dict):
    con = sqlite3.connect(DB_PATH)
    con.execute("INSERT OR REPLACE INTO history VALUES (?,?,?,?,?,?,?,?,?,?)", (
        row["id"], row["url"], row["title"], row["thumbnail"],
        row["channel"], row["duration"], row["dl_type"],
        row["file_path"], row["status"], row["created_at"]
    ))
    con.commit(); con.close()

def db_update_status(dl_id: str, status: str, file_path: str = ""):
    con = sqlite3.connect(DB_PATH)
    con.execute("UPDATE history SET status=?, file_path=? WHERE id=?", (status, file_path, dl_id))
    con.commit(); con.close()

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/")
def home():
    return {"status": "GRABIX Backend Running"}

@app.get("/check-link")
def check_link(url: str):
    # FIX: Added socket_timeout to prevent "read operation timed out" error.
    # FIX: Added extract_flat=False to ensure full duration is returned.
    # FIX: noplaylist=True prevents fetching entire playlists by accident.
    opts = {
        "quiet": True,
        "noplaylist": True,
        "skip_download": True,
        "socket_timeout": 15,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            formats = _get_formats(info)
            return {
                "valid": True,
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail", ""),
                # FIX: was "duration" in the extractor but frontend expected "duration_seconds"
                # Now we return both so either side works.
                "duration": info.get("duration", 0),
                "duration_seconds": info.get("duration", 0),
                "uploader": info.get("channel") or info.get("uploader", ""),
                "channel": info.get("channel") or info.get("uploader", ""),
                # FIX: return plain string list like ["1080p","720p"] not objects
                "formats": formats,
            }
    except Exception as e:
        return {"valid": False, "error": str(e)}


def _get_formats(info: dict) -> list[str]:
    """Return a clean sorted list of quality strings like ['2160p','1080p','720p',...]"""
    seen, result = set(), []
    for f in (info.get("formats") or []):
        h = f.get("height")
        if h and h not in seen:
            seen.add(h)
            result.append(h)
    # Sort descending, convert to strings
    return [f"{h}p" for h in sorted(result, reverse=True)] or ["1080p", "720p", "480p", "360p"]


def _build_video_format_selector(quality: str) -> str:
    if quality == "best":
        if has_ffmpeg():
            return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        return "best[ext=mp4]/best"

    h = quality.replace("p", "")
    if has_ffmpeg():
        # FIX: removed [ext=mp4] from bestvideo selector — many videos only have webm at
        # high resolutions. Let ffmpeg merge whatever is best, then remux to mp4.
        return (
            f"bestvideo[height<={h}]+bestaudio/best[height<={h}][ext=mp4]"
            f"/best[height<={h}]/best"
        )
    return f"best[height<={h}][ext=mp4]/best[height<={h}]/best"


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
        ),
        daemon=True,
    )
    download_controls[dl_id]["thread"] = worker
    worker.start()

@app.post("/download")
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
    }
    _create_download_record(dl_id, params=params)

    # Quick metadata fetch for DB (non-blocking, best-effort)
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True, "socket_timeout": 10}) as ydl:
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
    except Exception:
        pass

    _start_download_thread(dl_id)
    return {"id": dl_id, "folder": DOWNLOAD_DIR}


# FIX: Added /progress/{dl_id} alias — frontend was calling this endpoint
# but only /download-status/{dl_id} existed. Both now work.
@app.get("/progress/{dl_id}")
@app.get("/download-status/{dl_id}")
def download_status(dl_id: str):
    item = downloads.get(dl_id)
    return _public_download(item) if item else {"status": "not_found"}


@app.get("/downloads")
def list_downloads():
    ordered = sorted(downloads.values(), key=lambda item: item.get("created_at", ""), reverse=True)
    return [_public_download(item) for item in ordered]

@app.get("/history")
def get_history():
    con = sqlite3.connect(DB_PATH)
    rows = con.execute("SELECT * FROM history ORDER BY created_at DESC LIMIT 100").fetchall()
    con.close()
    keys = ["id","url","title","thumbnail","channel","duration","dl_type","file_path","status","created_at"]
    return [dict(zip(keys, r)) for r in rows]


@app.post("/open-download-folder")
def open_download_folder(path: str = ""):
    target = Path(path) if path else Path(DOWNLOAD_DIR)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Download folder not found")

    try:
        if os.name == "nt":
            if target.is_file():
                subprocess.Popen(["explorer", "/select,", str(target)])
            else:
                os.startfile(str(target))
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
            "status": "queued",
            "percent": 0,
            "speed": "",
            "eta": "",
            "downloaded": "",
            "total": "",
            "size": "",
            "error": "",
            "file_path": "",
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

# ── Download Task ─────────────────────────────────────────────────────────────
def _download_task(dl_id, url, dl_type, quality, audio_format, audio_quality,
                   subtitle_lang, thumbnail_format, trim_start, trim_end, trim_enabled):
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
            speed = d.get("_speed_str", "").strip()
            if not speed and raw_speed:
                speed = f"{_format_bytes(raw_speed)}/s"
            eta = d.get("_eta_str", "").strip() or _format_eta(d.get("eta"))
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
    opts: dict = {
        "outtmpl": template,
        "noplaylist": True,
        "progress_hooks": [progress_hook],
        "continuedl": True,
        "socket_timeout": 30,
    }

    try:
        if dl_type == "video":
            opts["format"] = _build_video_format_selector(quality)
            # FIX: only apply trim when trim_enabled is True
            if trim_enabled and trim_end > trim_start:
                if not has_ffmpeg():
                    raise RuntimeError("Trimming requires FFmpeg. Install FFmpeg or turn off Trim.")
                opts["download_ranges"] = yt_dlp.utils.download_range_func(
                    None, [(trim_start, trim_end)]
                )
                opts["force_keyframes_at_cuts"] = True
            # FIX: merge into mp4 container when ffmpeg available
            if has_ffmpeg():
                opts["merge_output_format"] = "mp4"

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

        file_path = downloads[dl_id].get("file_path") or f"{DOWNLOAD_DIR}"
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
