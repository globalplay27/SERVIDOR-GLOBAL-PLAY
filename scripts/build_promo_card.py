#!/usr/bin/env python3
import argparse
import json
import os
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

W, H = 1080, 1920
PANEL_Y = 790

def clean(value, limit=5000):
    return " ".join(str(value or "").replace("\n", " ").replace("\r", " ").split())[:limit]

def font_path(bold=False):
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return p
    raise RuntimeError("promo_font_missing")

def font(size, bold=False):
    return ImageFont.truetype(font_path(bold), size)

def fit_lines(draw, text, face, max_width, max_lines):
    words = clean(text).split()
    if not words:
        return []
    lines, line = [], ""
    for word in words:
        candidate = (line + " " + word).strip()
        if line and draw.textlength(candidate, font=face) > max_width:
            lines.append(line)
            line = word
            if len(lines) >= max_lines:
                break
        else:
            line = candidate
    if len(lines) < max_lines and line:
        lines.append(line)
    # Ellipsis when content was truncated.
    rendered = " ".join(lines)
    original = " ".join(words)
    if len(lines) == max_lines and rendered != original:
        tail = lines[-1]
        while tail and draw.textlength(tail + "…", font=face) > max_width:
            tail = tail[:-1].rstrip()
        lines[-1] = (tail.rstrip(" .") + "…") if tail else "…"
    return lines

def draw_wrapped(draw, text, xy, max_width, size, fill, bold=False, max_lines=6, line_gap=10):
    x, y = xy
    face = font(size, bold)
    lines = fit_lines(draw, text, face, max_width, max_lines)
    for line in lines:
        draw.text((x, y), line, font=face, fill=fill)
        y += size + line_gap
    return y

def rounded_poster(path, size):
    img = Image.open(path).convert("RGB")
    img = ImageOps.fit(img, size, method=Image.Resampling.LANCZOS)
    mask = Image.new("L", size, 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, size[0]-1, size[1]-1), radius=28, fill=255)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0), mask)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", required=True)
    ap.add_argument("--poster", default="")
    args = ap.parse_args()

    title = clean(os.getenv("TITLE"), 180)
    overview = clean(os.getenv("OVERVIEW"), 1800)
    year = clean(os.getenv("RELEASE_YEAR"), 12)
    media_type = clean(os.getenv("MEDIA_TYPE"), 32).upper()
    contact = clean(os.getenv("END_CONTACT"), 40)
    meta_raw = os.getenv("MOVIE_METADATA", "").strip()
    try:
        metadata = json.loads(meta_raw) if meta_raw else {}
    except Exception:
        metadata = {}

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    # If no usable catalog data exists, keep the successful plain 9:16 output.
    promo_ready = bool(title and overview)
    if not promo_ready:
        raise ValueError("video_metadata_required")

    # Cinematic transition into a custom NEXUS information card. No third-party branding.
    for y in range(PANEL_Y - 90, PANEL_Y + 130):
        t = max(0.0, min(1.0, (y - (PANEL_Y - 90)) / 220.0))
        alpha = int(245 * t)
        d.rectangle((0, y, W, y + 1), fill=(5, 10, 15, alpha))
    d.rectangle((0, PANEL_Y + 130, W, H), fill=(5, 10, 15, 248))
    d.rectangle((0, PANEL_Y + 128, W, PANEL_Y + 132), fill=(64, 190, 235, 110))

    x = 68
    text_w = 540
    y = PANEL_Y + 190

    badge = clean(media_type or "DESTAQUE", 30)
    badge_face = font(22, True)
    badge_w = int(d.textlength(badge, font=badge_face)) + 34
    d.rounded_rectangle((x, y, x + badge_w, y + 42), radius=18, fill=(24, 139, 184, 225))
    d.text((x + 17, y + 8), badge, font=badge_face, fill=(245, 252, 255, 255))
    y += 64

    title_size = 54
    title_face = font(title_size, True)
    title_lines = fit_lines(d, title, title_face, text_w, 2)
    for line in title_lines:
        d.text((x, y), line, font=title_face, fill=(255, 255, 255, 255))
        y += title_size + 6

    runtime = clean(metadata.get("runtime"), 40)
    rating = clean(metadata.get("rating"), 40)
    genres = clean(metadata.get("genres"), 90)
    meta_bits = [v for v in [year, runtime, rating] if v]
    if meta_bits:
        y += 8
        d.text((x, y), "  •  ".join(meta_bits), font=font(23, False), fill=(177, 202, 217, 255))
        y += 43
    if genres:
        genre_lines = fit_lines(d, genres, font(22, False), text_w, 2)
        for line in genre_lines:
            d.text((x, y), line, font=font(22, False), fill=(145, 180, 199, 255))
            y += 31

    y += 20
    draw_wrapped(d, overview, (x, y), text_w, 27, (232, 239, 244, 255), False, 7, 10)

    poster_path = Path(args.poster) if args.poster else None
    if poster_path and poster_path.exists() and poster_path.stat().st_size:
        poster = rounded_poster(str(poster_path), (350, 525))
        # soft halo
        d.rounded_rectangle((641, PANEL_Y + 180, 1019, PANEL_Y + 733), radius=36, fill=(65, 182, 224, 50))
        overlay.alpha_composite(poster, (655, PANEL_Y + 194))
        d.rounded_rectangle((655, PANEL_Y + 194, 1005, PANEL_Y + 719), radius=28, outline=(211, 238, 249, 190), width=3)

    cta_y = 1660
    d.text((x, cta_y), "ASSISTA AGORA", font=font(22, True), fill=(117, 205, 239, 255))
    if contact:
        digits = re.sub(r"\D+", "", contact)
        display = contact if len(contact) <= 24 else digits
        d.rounded_rectangle((x, cta_y + 42, x + 480, cta_y + 112), radius=28, fill=(19, 129, 72, 238))
        d.text((x + 28, cta_y + 59), "WHATSAPP  " + display, font=font(27, True), fill=(255, 255, 255, 255))

    overlay.save(args.output)

if __name__ == "__main__":
    main()
