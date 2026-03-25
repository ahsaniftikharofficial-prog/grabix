from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp, os, uuid, sqlite3
from pathlib import Path
from datetime import datetime

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

DOWNLOAD_DIR = str(Path.home() / "Downloads" / "GRABIX")
DB_PATH = str(Path.home() / "Downloads" / "GRABIX" / "grabix.db")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# In-memory progress store
downloads: dict = {}

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
    opts = {"quiet": True, "noplaylist": True, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                "valid": True,
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail", ""),
                "duration": info.get("duration", 0),
                "channel": info.get("channel") or info.get("uploader", ""),
                "formats": _get_formats(info),
            }
    except Exception as e:
        return {"valid": False, "error": str(e)}

def _get_formats(info: dict) -> list:
    seen, result = set(), []
    for f in (info.get("formats") or []):
        h = f.get("height")
        if h and h not in seen:
            seen.add(h)
            result.append({"height": h, "label": f"{h}p"})
    return sorted(result, key=lambda x: -x["height"])

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
    background_tasks: BackgroundTasks = None,
):
    dl_id = str(uuid.uuid4())
    downloads[dl_id] = {"status": "queued", "percent": 0, "speed": "", "eta": "", "title": ""}

    # Quick metadata fetch for DB
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True}) as ydl:
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
    except:
        pass

    background_tasks.add_task(
        _download_task, dl_id, url, dl_type, quality,
        audio_format, audio_quality, subtitle_lang,
        thumbnail_format, trim_start, trim_end, trim_enabled
    )
    return {"id": dl_id, "folder": DOWNLOAD_DIR}

@app.get("/download-status/{dl_id}")
def download_status(dl_id: str):
    return downloads.get(dl_id, {"status": "not_found"})

@app.get("/history")
def get_history():
    con = sqlite3.connect(DB_PATH)
    rows = con.execute("SELECT * FROM history ORDER BY created_at DESC LIMIT 100").fetchall()
    con.close()
    keys = ["id","url","title","thumbnail","channel","duration","dl_type","file_path","status","created_at"]
    return [dict(zip(keys, r)) for r in rows]

# ── Download Task ─────────────────────────────────────────────────────────────
def _download_task(dl_id, url, dl_type, quality, audio_format, audio_quality,
                   subtitle_lang, thumbnail_format, trim_start, trim_end, trim_enabled):
    downloads[dl_id]["status"] = "downloading"

    def progress_hook(d):
        if d["status"] == "downloading":
            raw = d.get("_percent_str", "0%").strip().replace("%","")
            try: pct = float(raw)
            except: pct = 0
            downloads[dl_id].update({
                "percent": round(pct, 1),
                "speed": d.get("_speed_str", ""),
                "eta": d.get("_eta_str", ""),
            })
        elif d["status"] == "finished":
            downloads[dl_id]["percent"] = 100

    template = f"{DOWNLOAD_DIR}/%(title)s.%(ext)s"
    opts: dict = {"outtmpl": template, "noplaylist": True, "progress_hooks": [progress_hook]}

    try:
        if dl_type == "video":
            fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
            if quality != "best":
                h = quality.replace("p","")
                fmt = f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/best[height<={h}]"
            opts["format"] = fmt
            if trim_enabled and trim_end > trim_start:
                opts["download_ranges"] = yt_dlp.utils.download_range_func(
                    None, [(trim_start, trim_end)]
                )
                opts["force_keyframes_at_cuts"] = True

        elif dl_type == "audio":
            opts["format"] = "bestaudio/best"
            opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": audio_format,
                "preferredquality": audio_quality,
            }]

        elif dl_type == "thumbnail":
            opts["skip_download"] = True
            opts["writethumbnail"] = True
            opts["postprocessors"] = [{"key": "FFmpegThumbnailsConvertor", "format": thumbnail_format}]

        elif dl_type == "subtitle":
            opts["skip_download"] = True
            opts["writesubtitles"] = True
            opts["writeautomaticsub"] = True
            opts["subtitleslangs"] = [subtitle_lang]

        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        file_path = f"{DOWNLOAD_DIR}"
        downloads[dl_id]["status"] = "done"
        downloads[dl_id]["percent"] = 100
        db_update_status(dl_id, "done", file_path)

    except Exception as e:
        downloads[dl_id]["status"] = "failed"
        downloads[dl_id]["error"] = str(e)
        db_update_status(dl_id, "failed")
