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

DOWNLOAD_DIR = str(Path.home() / "Downloads" / "GRABIX")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# In-memory task store: task_id -> { status, percent, speed, title, error }
tasks: dict = {}


class ProgressLogger:
    """Passed to yt-dlp as a progress hook. Updates the tasks dict."""
    def __init__(self, task_id: str):
        self.task_id = task_id

    def __call__(self, d: dict):
        if d["status"] == "downloading":
            raw = d.get("_percent_str", "0%").strip().replace("%", "")
            try:
                percent = float(raw)
            except ValueError:
                percent = 0.0
            tasks[self.task_id]["percent"] = round(percent, 1)
            tasks[self.task_id]["speed"] = d.get("_speed_str", "").strip()
            tasks[self.task_id]["eta"] = d.get("_eta_str", "").strip()
            tasks[self.task_id]["status"] = "downloading"

        elif d["status"] == "finished":
            tasks[self.task_id]["percent"] = 100.0
            tasks[self.task_id]["status"] = "processing"
            tasks[self.task_id]["speed"] = ""


def download_media_task(task_id: str, url: str, format_type: str):
    logger = ProgressLogger(task_id)
    ydl_opts = {
        "outtmpl": f"{DOWNLOAD_DIR}/%(title)s.%(ext)s",
        "quiet": True,
        "noplaylist": True,
        "progress_hooks": [logger],
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
        tasks[task_id]["status"] = "done"
        tasks[task_id]["percent"] = 100.0
    except Exception as e:
        tasks[task_id]["status"] = "error"
        tasks[task_id]["error"] = str(e)


@app.get("/")
def home():
    return {"status": "GRABIX Backend Running"}


@app.get("/check-link")
def check_link(url: str):
    ydl_opts = {"quiet": True, "noplaylist": True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            duration = info.get("duration", 0)
            mins = duration // 60
            secs = duration % 60
            return {
                "valid": True,
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail", ""),
                "duration": f"{mins}:{secs:02d}",
                "uploader": info.get("uploader", ""),
            }
    except Exception as e:
        return {"valid": False, "error": str(e)}


@app.get("/download")
def start_download(url: str, format: str, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "queued",
        "percent": 0.0,
        "speed": "",
        "eta": "",
        "error": "",
    }
    background_tasks.add_task(download_media_task, task_id, url, format)
    return {"task_id": task_id, "folder": DOWNLOAD_DIR}


@app.get("/progress/{task_id}")
def get_progress(task_id: str):
    if task_id not in tasks:
        return {"error": "Task not found"}
    return tasks[task_id]