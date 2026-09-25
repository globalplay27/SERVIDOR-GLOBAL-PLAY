import json
import os
import pathlib
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("PORT", "8080"))
MAX_BYTES = 95 * 1024 * 1024

def valid_youtube_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https":
            return False
        return host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
    except Exception:
        return False

class Handler(BaseHTTPRequestHandler):
    server_version = "NexusYouTubeDownloader/1.0"

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "service": "nexus-youtube-downloader"})
        return self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/download":
            return self._json(404, {"error": "not_found"})

        try:
            length = int(self.headers.get("content-length", "0") or "0")
            if length <= 0 or length > 64 * 1024:
                return self._json(400, {"error": "invalid_request"})
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "invalid_json"})

        url = str(payload.get("url") or "").strip()
        if not valid_youtube_url(url):
            return self._json(400, {"error": "invalid_youtube_url"})

        workdir = tempfile.mkdtemp(prefix="nexus-youtube-")
        try:
            output = os.path.join(workdir, "video.%(ext)s")
            command = [
                "yt-dlp",
                "--no-playlist",
                "--no-warnings",
                "--socket-timeout", "20",
                "--retries", "2",
                "--fragment-retries", "2",
                "--max-filesize", "95M",
                "--merge-output-format", "mp4",
                "--js-runtimes", "node",
                "-f", "best[ext=mp4][height<=720]/best[height<=720]/best",
                "-o", output,
                url,
            ]

            proc = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=210,
                check=False,
            )
            if proc.returncode != 0:
                detail = " ".join((proc.stderr or proc.stdout or "").split())[-900:]
                return self._json(502, {"error": "yt_dlp_failed", "detail": detail})

            candidates = sorted(
                [p for p in pathlib.Path(workdir).iterdir() if p.is_file()],
                key=lambda p: p.stat().st_size,
                reverse=True,
            )
            if not candidates:
                return self._json(502, {"error": "download_empty"})

            path = candidates[0]
            size = path.stat().st_size
            if size <= 0:
                return self._json(502, {"error": "download_empty"})
            if size > MAX_BYTES:
                return self._json(413, {"error": "video_too_large", "size": size})

            suffix = path.suffix.lower()
            content_type = "video/webm" if suffix == ".webm" else "video/mp4"
            self.send_response(200)
            self.send_header("content-type", content_type)
            self.send_header("content-length", str(size))
            self.send_header("x-nexus-source", "yt-dlp-container")
            self.send_header("x-nexus-extension", suffix.lstrip(".") or "mp4")
            self.end_headers()

            with open(path, "rb") as stream:
                shutil.copyfileobj(stream, self.wfile, length=1024 * 1024)
        except subprocess.TimeoutExpired:
            return self._json(504, {"error": "yt_dlp_timeout"})
        except BrokenPipeError:
            return
        except Exception as exc:
            return self._json(500, {"error": "container_download_failed", "detail": str(exc)[:500]})
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def log_message(self, fmt, *args):
        print("[youtube-container] " + (fmt % args), flush=True)

if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
