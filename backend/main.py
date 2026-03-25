from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp
import os
import uuid
from pathlib import Path

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Save downloads to user's Downloads/GRABIX folder
DOWNLOAD_DIR = str(Path.home() / "Downloads" / "GRABIX")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# In-memory store for download progress
# Key: download_id, Value: dict with status info
downloads: dict = {}


@app.get("/")
def home():
    return {"status": "GRABIX Backend is Running"}


@app.get("/check-link")
def check_link(url: str):
    ydl_opts = {"quiet": True, "noplaylist": True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                "valid": True,
                "title": info.get("title", "Unknown Title"),
                "thumbnail": info.get("thumbnail", ""),
                "duration": info.get("duration", 0),
            }
    except Exception as e:
        return {"valid": False, "error": str(e)}


def download_media_task(download_id: str, url: str, format_type: str):
    """Background task — runs the actual download and updates progress."""

    def progress_hook(d):
        if d["status"] == "downloading":
            # yt-dlp gives us these values directly
            downloaded = d.get("downloaded_bytes", 0)
            total = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
            speed = d.get("speed", 0) or 0
            percent = round((downloaded / total) * 100, 1) if total > 0 else 0

            downloads[download_id].update({
                "status": "downloading",
                "percent": percent,
                "speed": f"{round(speed / 1024, 1)} KB/s" if speed else "...",
                "downloaded": downloaded,
                "total": total,
            })

        elif d["status"] == "finished":
            downloads[download_id].update({
                "status": "processing",
                "percent": 99,
                "speed": "",
            })

    ydl_opts = {
        "outtmpl": f"{DOWNLOAD_DIR}/%(title)s.%(ext)s",
        "quiet": True,
        "noplaylist": True,
        "progress_hooks": [progress_hook],
    }

    if format_type == "audio":
        ydl_opts.update({
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        })
    else:
        ydl_opts.update({
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        downloads[download_id].update({
            "status": "done",
            "percent": 100,
            "speed": "",
            "folder": DOWNLOAD_DIR,
        })
    except Exception as e:
        downloads[download_id].update({
            "status": "error",
            "error": str(e),
        })


@app.get("/download")
def start_download(url: str, format: str, background_tasks: BackgroundTasks):
    download_id = str(uuid.uuid4())
    downloads[download_id] = {
        "status": "starting",
        "percent": 0,
        "speed": "",
        "url": url,
        "format": format,
    }
    background_tasks.add_task(download_media_task, download_id, url, format)
    return {"download_id": download_id, "folder": DOWNLOAD_DIR}


@app.get("/progress/{download_id}")
def get_progress(download_id: str):
    if download_id not in downloads:
        return {"status": "not_found"}
    return downloads[download_id]
