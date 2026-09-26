import os
import pathlib
import subprocess
import tempfile
import threading
import requests
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="NEXUS YouTube Downloader", version="1.0")

SERVICE_SECRET = os.getenv("NEXUS_DOWNLOADER_SECRET", "").strip()
MAX_MB = int(os.getenv("MAX_VIDEO_MB", "95"))
USER_AGENT = os.getenv(
    "YOUTUBE_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
)

class IngestRequest(BaseModel):
    source_url: str
    job_id: str
    client_id: str
    callback_token: str
    callback_base: str
    title: str = "video-youtube"

def _auth(authorization: str | None):
    if SERVICE_SECRET:
        expected = f"Bearer {SERVICE_SECRET}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="unauthorized")

def _safe_name(value: str) -> str:
    cleaned = "".join(c for c in value if c.isalnum() or c in " ._-").strip()
    return (cleaned[:120] or "video-youtube") + ".mp4"

def _report_failure(payload: IngestRequest, code: str):
    try:
        requests.post(
            payload.callback_base.rstrip("/") + "/api/internal/video-ingest/fail",
            headers={
                "x-nexus-job-id": payload.job_id,
                "x-nexus-client-id": payload.client_id,
                "x-nexus-callback-token": payload.callback_token,
                "content-type": "application/json",
            },
            json={"error": code[:300]},
            timeout=20,
        )
    except Exception:
        pass

def _download_and_upload(payload: IngestRequest):
    try:
        with tempfile.TemporaryDirectory(prefix="nexus-ytdlp-") as tmp:
            outtmpl = str(pathlib.Path(tmp) / "video.%(ext)s")
            cmd = [
                "yt-dlp",
                "--no-playlist",
                "--user-agent", USER_AGENT,
                "--add-header", "Accept-Language:pt-BR,pt;q=0.9,en;q=0.8",
                "--socket-timeout", "30",
                "--retries", "5",
                "--fragment-retries", "5",
                "--merge-output-format", "mp4",
                "--max-filesize", f"{MAX_MB}M",
                "-f", "bv*[height<=720]+ba/b[height<=720]/best[height<=720]",
                "-o", outtmpl,
                payload.source_url,
            ]

            cookie_file = os.getenv("YOUTUBE_COOKIES_FILE", "").strip()
            if cookie_file and pathlib.Path(cookie_file).is_file():
                cmd[1:1] = ["--cookies", cookie_file]

            subprocess.run(cmd, check=True, timeout=900)

            files = sorted(pathlib.Path(tmp).glob("video.*"))
            if not files:
                raise RuntimeError("download_produced_no_file")
            video = files[0]
            size = video.stat().st_size
            if size <= 0:
                raise RuntimeError("download_empty_file")
            if size > MAX_MB * 1024 * 1024:
                raise RuntimeError("video_too_large")

            with video.open("rb") as body:
                response = requests.put(
                    payload.callback_base.rstrip("/") + "/api/internal/video-ingest/upload",
                    headers={
                        "x-nexus-job-id": payload.job_id,
                        "x-nexus-client-id": payload.client_id,
                        "x-nexus-callback-token": payload.callback_token,
                        "x-nexus-file-name": _safe_name(payload.title),
                        "content-type": "video/mp4",
                        "content-length": str(size),
                    },
                    data=body,
                    timeout=900,
                )
            response.raise_for_status()
    except subprocess.CalledProcessError:
        _report_failure(payload, "downloader_yt_dlp_failed")
    except subprocess.TimeoutExpired:
        _report_failure(payload, "downloader_timeout")
    except Exception as exc:
        _report_failure(payload, "downloader_" + str(exc).replace(" ", "_")[:220])

@app.get("/health")
def health():
    return {"ok": True, "service": "nexus-youtube-downloader"}

@app.post("/ingest", status_code=202)
def ingest(payload: IngestRequest, authorization: str | None = Header(default=None)):
    _auth(authorization)
    if not payload.source_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="https_required")
    if not payload.callback_base.startswith("https://"):
        raise HTTPException(status_code=400, detail="callback_https_required")
    threading.Thread(target=_download_and_upload, args=(payload,), daemon=True).start()
    return {"accepted": True, "job_id": payload.job_id}
