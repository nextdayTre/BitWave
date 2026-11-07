#!/usr/bin/env python3
"""Generate the PWA icon set for the hosted BitWave build.

Run:  python tools/make-pwa-icons.py
Out:  assets/pwa/icon-192.png, icon-512.png, icon-maskable-512.png, favicon-32.png

The mark is the instrument's own language: a bright register-wave on near-black,
with the faint centre axis and the ∞ point. Palette tokens are copied from
src/styles/app.css :root (no new colours). Deterministic: same script, same bytes.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

BG = "#08090c"       # --bg
LINE = "#1b212b"     # --line
ACCENT = "#34d399"   # --accent
PANEL = "#0d1015"    # --panel

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "pwa"


def wave_points(left: float, right: float, centre_y: float, amplitude: float, steps: int = 240):
    points = []
    for i in range(steps + 1):
        t = i / steps
        x = left + (right - left) * t
        y = centre_y - amplitude * math.sin(2 * math.pi * t)
        points.append((x, y))
    return points


def stroke_path(draw: ImageDraw.ImageDraw, points, colour: str, width: float) -> None:
    """Round-capped stroke: stamp discs along the path (no joint spikes)."""
    r = width / 2
    for x, y in points:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)


def draw_mark(size: int, maskable: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable:
        # Full bleed; the mark stays inside the central ~66 % safe zone.
        d.rectangle([0, 0, size, size], fill=BG)
        art = size * 0.62
    else:
        radius = int(size * 0.19)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG)
        art = size * 0.84

    left = (size - art) / 2
    right = left + art
    centre_y = size * 0.50
    amplitude = art * 0.30
    stroke = max(2, round(size * 0.055))

    # Faint column rule and centre axis: the instrument's stage, not decoration.
    rule = max(1, round(size * 0.006))
    d.line([(size * 0.5, left + art * 0.04), (size * 0.5, left + art * 0.92)], fill=LINE, width=rule)
    d.line([(left + art * 0.04, centre_y), (right - art * 0.04, centre_y)], fill=LINE, width=rule)

    # The register wave.
    stroke_path(
        d,
        wave_points(left + art * 0.06, right - art * 0.06, centre_y, amplitude),
        ACCENT,
        stroke,
    )

    # The ∞ point at the centre of the register.
    ring = max(1.5, size * 0.014)
    dot = size * 0.028
    d.ellipse(
        [size * 0.5 - dot, centre_y - dot, size * 0.5 + dot, centre_y + dot],
        outline=ACCENT,
        width=max(1, round(ring)),
    )
    d.ellipse(
        [size * 0.5 - dot * 0.30, centre_y - dot * 0.30, size * 0.5 + dot * 0.30, centre_y + dot * 0.30],
        fill=PANEL,
    )
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = draw_mark(512, maskable=False)
    maskable = draw_mark(512, maskable=True)

    master.resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png", optimize=True)
    master.save(OUT / "icon-512.png", optimize=True)
    maskable.save(OUT / "icon-maskable-512.png", optimize=True)
    master.resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png", optimize=True)

    for name in ("icon-192.png", "icon-512.png", "icon-maskable-512.png", "favicon-32.png"):
        path = OUT / name
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
