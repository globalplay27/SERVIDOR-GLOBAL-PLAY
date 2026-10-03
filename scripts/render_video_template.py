"""Single locked NEXUS customer video template: 9:16, hand + phone, source video and synopsis inside the phone."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import urllib.request
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter

W, H = 1080, 1920
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/assets/video-template"

PHONE_X, PHONE_Y = 60, 350
PHONE_W, PHONE_H = 846, 1538
SCREEN_X, SCREEN_Y = 281, 518
SCREEN_W, VIDEO_H = 492, 620
INFO_Y, INFO_H = 1150, 408

def font(size, bold=False):
    candidates = [
        os.getenv("NEXUS_FONT", ""),
        f'/usr/share/fonts/truetype/dejavu/DejaVuSans{"-Bold" if bold else ""}.ttf',
        f'C:/Windows/Fonts/arial{"bd" if bold else ""}.ttf'
    ]
    for path in candidates:
        if path and Path(path).exists():
            return ImageFont.truetype(path, size)
    raise RuntimeError("render_font_missing")

def wrapped_lines(draw, text, face, width):
    out, line = [], ""
    for word in " ".join(str(text or "").split()).split():
        candidate = (line + " " + word).strip()
        if line and draw.textlength(candidate, font=face) > width:
            out.append(line)
            line = word
        else:
            line = candidate
    if line:
        out.append(line)
    return out

def draw_fit(draw, text, box, size, bold=False, fill="white", centered=False, max_lines=None):
    x, y, right, bottom = box
    text = " ".join(str(text or "").split())
    if not text:
        return y
    chosen = None
    while size >= 15:
        face = font(size, bold)
        lines = wrapped_lines(draw, text, face, right - x)
        spacing = int(size * 1.28)
        if max_lines:
            lines = lines[:max_lines]
        if len(lines) * spacing <= bottom - y:
            chosen = (face, lines, spacing)
            break
        size -= 1
    if chosen is None:
        face = font(15, bold)
        lines = wrapped_lines(draw, text, face, right - x)
        spacing = 19
        chosen = (face, lines[:max_lines or max(1, (bottom-y)//spacing)], spacing)
    face, lines, spacing = chosen
    raw = wrapped_lines(draw, text, face, right - x)
    if max_lines and len(raw) > max_lines and lines:
        tail = lines[-1]
        while tail and draw.textlength(tail + "…", font=face) > right - x:
            tail = tail[:-1].rstrip()
        lines[-1] = (tail.rstrip(" .") + "…") if tail else "…"
    for line in lines:
        at_x = x + max(0, (right - x - draw.textlength(line, font=face)) / 2) if centered else x
        draw.text((at_x, y), line, font=face, fill=fill)
        y += spacing
    return y

def safe_image(path):
    try:
        p = Path(path)
        if p.exists() and p.stat().st_size:
            return Image.open(p).convert("RGB")
    except Exception:
        pass
    return None

def extract_reference_frame(source, output):
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", "1", "-i", str(source), "-frames:v", "1", str(output)
    ], check=True)

def make_background(reference):
    bg = ImageOps.fit(reference.convert("RGB"), (W, H)).convert("RGBA")
    bg = bg.filter(ImageFilter.GaussianBlur(18))
    bg = Image.alpha_composite(bg, Image.new("RGBA", (W, H), (0, 0, 0, 118)))
    return bg

def prepare_template(work, metadata, source, poster_path=None):
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)

    poster = safe_image(poster_path) if poster_path else None
    if poster is None:
        poster_name = metadata.get("poster")
        folder = Path(metadata.get("_folder") or work)
        poster = safe_image(folder / poster_name) if poster_name else None
    if poster is None:
        frame = work / "source-frame.jpg"
        extract_reference_frame(source, frame)
        poster = Image.open(frame).convert("RGB")

    bg = make_background(poster)
    bg.save(work / "background.png")

    under = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(under)

    # Phone screen underlay. The moving video occupies the upper portion;
    # title and synopsis are locked inside the lower phone area.
    d.rounded_rectangle(
        (SCREEN_X, SCREEN_Y, SCREEN_X + SCREEN_W, SCREEN_Y + 1040),
        radius=48, fill=(2, 6, 11, 255)
    )
    d.rectangle(
        (SCREEN_X + 10, INFO_Y - 18, SCREEN_X + SCREEN_W - 10, SCREEN_Y + 1030),
        fill=(2, 6, 11, 245)
    )

    title = " ".join(str(metadata.get("title") or os.getenv("TITLE") or "").split())
    overview = " ".join(str(metadata.get("overview") or os.getenv("OVERVIEW") or "").split())
    year = " ".join(str(metadata.get("year") or os.getenv("RELEASE_YEAR") or "").split())
    media = " ".join(str(metadata.get("media_type") or metadata.get("mediaType") or os.getenv("MEDIA_TYPE") or "").split())

    title_y = INFO_Y
    if title:
        title_y = draw_fit(
            d, title,
            (SCREEN_X + 28, INFO_Y, SCREEN_X + SCREEN_W - 28, INFO_Y + 74),
            31, bold=True, centered=True, max_lines=2
        )
    meta_line = " • ".join(x for x in [media.upper(), year] if x)
    if meta_line:
        title_y = draw_fit(
            d, meta_line,
            (SCREEN_X + 30, title_y + 2, SCREEN_X + SCREEN_W - 30, title_y + 38),
            18, centered=True, max_lines=1
        )

    # Synopsis is always inside the phone and is capped to five lines.
    draw_fit(
        d, overview,
        (SCREEN_X + 34, max(title_y + 14, INFO_Y + 78), SCREEN_X + SCREEN_W - 34, SCREEN_Y + 1012),
        24, fill="#eef3f7", centered=False, max_lines=5
    )
    under.save(work / "phone-underlay.png")

    front = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hand_path = ASSETS / "phone-hand.webp"
    if hand_path.exists():
        hand = Image.open(hand_path).convert("RGBA").resize((PHONE_W, PHONE_H), Image.Resampling.LANCZOS)
        front.alpha_composite(hand, (PHONE_X, PHONE_Y))

    popcorn_path = ASSETS / "popcorn.webp"
    if popcorn_path.exists():
        popcorn = Image.open(popcorn_path).convert("RGBA")
        popcorn.thumbnail((430, 520), Image.Resampling.LANCZOS)
        front.alpha_composite(popcorn, (650, 1370))

    front.save(work / "phone-foreground.png")

def render_fixed(source, output, work, duration, source_crop=None):
    prefix = (source_crop + "," if source_crop else "")
    dx = "10*sin(2*PI*t/3.2)"
    dy = "5*sin(2*PI*t/2.6)"
    graph = (
        f"[0:v]{prefix}scale={SCREEN_W}:{VIDEO_H}:force_original_aspect_ratio=increase,"
        f"crop={SCREEN_W}:{VIDEO_H},setsar=1,fps=30,format=rgba[clip];"
        "[1:v]scale=1080:1920,setsar=1,fps=30,format=rgba[bg];"
        "[2:v]setsar=1,fps=30,format=rgba[under];"
        "[3:v]setsar=1,fps=30,format=rgba[front];"
        f"[bg][under]overlay=x='{dx}':y='{dy}':shortest=1[a];"
        f"[a][clip]overlay=x='{SCREEN_X}+{dx}':y='{SCREEN_Y}+{dy}':shortest=1[b];"
        f"[b][front]overlay=x='{dx}':y='{dy}':shortest=1,format=yuv420p[out]"
    )
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source),
        "-loop", "1", "-i", str(Path(work)/"background.png"),
        "-loop", "1", "-i", str(Path(work)/"phone-underlay.png"),
        "-loop", "1", "-i", str(Path(work)/"phone-foreground.png"),
        "-filter_complex_threads", "1",
        "-filter_complex", graph,
        "-map", "[out]", "-map", "0:a?",
        "-t", str(duration), "-r", "30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", str(output)
    ]
    subprocess.run(cmd, check=True)

def load_metadata(path=None):
    if path:
        path = Path(path)
        data = json.loads(path.read_text(encoding="utf-8"))
        data["_folder"] = str(path.parent)
        return data
    return {}

def materialize_metadata(data, work, private_poster=None):
    folder = Path(work) / "assets"
    folder.mkdir(parents=True, exist_ok=True)

    def download(url, name):
        if not url:
            return ""
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host = parsed.hostname or ""
        allowed = ("tvmaze.com", "mzstatic.com", "tmdb.org")
        if parsed.scheme != "https" or not any(host == h or host.endswith("." + h) for h in allowed):
            return ""
        try:
            req = urllib.request.Request(url, headers={"User-Agent":"NEXUS-video-template"})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read(10*1024*1024+1)
            if len(raw) > 10*1024*1024:
                return ""
            p = folder / name
            p.write_bytes(raw)
            with Image.open(p) as img:
                img.verify()
            return name
        except Exception:
            return ""

    data = dict(data or {})
    if private_poster:
        data["poster"] = str(Path(private_poster).resolve())
        data["_folder"] = "/"
    else:
        data["poster"] = download(data.get("posterUrl"), "poster.jpg")
        data["_folder"] = str(folder)

    data["title"] = data.get("title") or os.getenv("TITLE", "")
    data["overview"] = os.getenv("OVERVIEW") or data.get("overview", "")
    data["year"] = data.get("year") or os.getenv("RELEASE_YEAR", "")
    data["media_type"] = data.get("mediaType") or data.get("media_type") or os.getenv("MEDIA_TYPE", "")
    return data

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for key in ["source", "output", "work"]:
        parser.add_argument("--" + key, required=True)
    parser.add_argument("--metadata")
    parser.add_argument("--poster")
    parser.add_argument("--duration", type=float, default=0)
    parser.add_argument("--source-crop")
    args = parser.parse_args()

    supplied = os.getenv("MOVIE_METADATA", "").strip()
    if args.metadata:
        metadata = load_metadata(args.metadata)
    else:
        try:
            raw = json.loads(supplied) if supplied else {}
        except Exception:
            raw = {}
        private_poster = "/tmp/poster.jpg" if Path("/tmp/poster.jpg").exists() else None
        metadata = materialize_metadata(raw, args.work, private_poster)

    source_duration = float(json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", args.source
    ]))["format"]["duration"])
    duration = min(source_duration, args.duration) if args.duration > 0 else source_duration
    duration = max(0.1, duration)

    prepare_template(args.work, metadata, args.source, args.poster)
    render_fixed(args.source, args.output, args.work, duration, args.source_crop)
