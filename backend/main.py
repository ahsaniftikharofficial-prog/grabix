from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp
import os
import json
import re
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


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/")
def home():
    return {"status": "GRABIX Backend is Running"}


# ── Fetch video info (NO download) ────────────────────────────────────────────
@app.get("/info")
def get_info(url: str):
    ydl_opts = {
        "quiet": True,
        "noplaylist": True,
        "skip_download": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                "valid": True,
                "title": info.get("title", "Unknown Title"),
                "thumbnail": info.get("thumbnail", ""),
                "duration": info.get("duration", 0),
                "uploader": info.get("uploader", ""),
                "view_count": info.get("view_count", 0),
                "upload_date": info.get("upload_date", ""),
            }
    except Exception as e:
        return {"valid": False, "error": str(e)}


# ── Download with SSE progress ────────────────────────────────────────────────
@app.get("/download")
def download_media(
    url: str,
    format: str = "video",
    quality: str = "best",
    trim: str = "0",
    start: str = "00:00",
    end: str = "00:00",
):
    """
    Streams download progress back to the frontend using Server-Sent Events.
    The frontend connects via EventSource and receives JSON messages.
    """

    def sse_event(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    def generate():
        # Build yt-dlp options
        ydl_opts = {
            "outtmpl": f"{DOWNLOAD_DIR}/%(title)s.%(ext)s",
            "quiet": True,
            "noplaylist": True,
            "progress_hooks": [progress_hook],
        }

        # Format selection
        if format == "audio":
            ydl_opts["format"] = "bestaudio/best"
            ydl_opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]
        elif format == "thumbnail":
            ydl_opts["skip_download"] = True
            ydl_opts["writethumbnail"] = True
            ydl_opts["outtmpl"] = f"{DOWNLOAD_DIR}/%(title)s.%(ext)s"
        elif format == "subtitles":
            ydl_opts["skip_download"] = True
            ydl_opts["writesubtitles"] = True
            ydl_opts["writeautomaticsub"] = True
            ydl_opts["subtitleslangs"] = ["en"]
        else:
            # Video quality
            quality_map = {
                "2160": "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]",
                "1080": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
                "720":  "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
                "480":  "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
                "360":  "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]",
            }
            ydl_opts["format"] = quality_map.get(quality, "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best")

        # Trim (requires FFmpeg)
        if trim == "1":
            def parse_time(t: str) -> float:
                parts = t.strip().split(":")
                try:
                    if len(parts) == 3:
                        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
                    elif len(parts) == 2:
                        return int(parts[0]) * 60 + float(parts[1])
                    return float(parts[0])
                except Exception:
                    return 0.0

            start_sec = parse_time(start)
            end_sec = parse_time(end)
            if end_sec > start_sec:
                ydl_opts["postprocessors"] = ydl_opts.get("postprocessors", []) + [{
                    "key": "FFmpegVideoRemuxer",
                    "preferedformat": "mp4",
                }]
                ydl_opts["download_ranges"] = lambda _info, _ydl: [{"start_time": start_sec, "end_time": end_sec}]
                ydl_opts["force_keyframes_at_cuts"] = True

        # ── Progress hook ──
        events = []

        def progress_hook(d):
            if d["status"] == "downloading":
                raw_pct = d.get("_percent_str", "0%").strip()
                pct_str = re.sub(r"\x1b\[[0-9;]*m", "", raw_pct)  # strip ANSI color codes
                try:
                    pct = float(pct_str.replace("%", ""))
                except ValueError:
                    pct = 0.0

                speed_raw = d.get("_speed_str", "").strip()
                speed = re.sub(r"\x1b\[[0-9;]*m", "", speed_raw)

                eta_raw = d.get("_eta_str", "").strip()
                eta = re.sub(r"\x1b\[[0-9;]*m", "", eta_raw)

                events.append(sse_event({"status": "progress", "percent": pct, "speed": speed, "eta": eta}))

            elif d["status"] == "finished":
                events.append(sse_event({"status": "progress", "percent": 100, "speed": "", "eta": ""}))

        # ── Run yt-dlp ──
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # Patch to stream events as they come
                # We run synchronously and yield events
                import threading

                error_holder = []

                def run():
                    try:
                        ydl.download([url])
                    except Exception as e:
                        error_holder.append(str(e))

                thread = threading.Thread(target=run)
                thread.start()

                import time
                while thread.is_alive() or events:
                    while events:
                        yield events.pop(0)
                    time.sleep(0.2)

                thread.join()

                if error_holder:
                    yield sse_event({"status": "error", "message": error_holder[0]})
                else:
                    yield sse_event({"status": "done", "folder": DOWNLOAD_DIR})

        except Exception as e:
            yield sse_event({"status": "error", "message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
