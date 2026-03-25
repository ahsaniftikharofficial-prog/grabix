from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp
import os
from pathlib import Path

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get the user's default Downloads folder
DOWNLOAD_DIR = str(Path.home() / "Downloads" / "GRABIX")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

@app.get("/")
def home():
    return {"status": "GRABIX Backend is Running"}

@app.get("/check-link")
def check_link(url: str):
    ydl_opts = {'quiet': True, 'noplaylist': True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                "valid": True,
                "title": info.get('title', 'Unknown Title'),
                "thumbnail": info.get('thumbnail', '')
            }
    except Exception as e:
        return {"valid": False, "error": str(e)}

def download_media_task(url: str, format_type: str):
    """Background task to handle the actual downloading"""
    ydl_opts = {
        'outtmpl': f'{DOWNLOAD_DIR}/%(title)s.%(ext)s',
        'quiet': False,
        'noplaylist': True,
    }
    
    if format_type == "audio":
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    else:
        # Best video + best audio combined
        ydl_opts.update({'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'})

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        print(f"Download failed: {e}")

@app.get("/download")
def download_media(url: str, format: str, background_tasks: BackgroundTasks):
    # We send it to a background task so the UI doesn't freeze while downloading
    background_tasks.add_task(download_media_task, url, format)
    return {"message": "Download started!", "folder": DOWNLOAD_DIR}