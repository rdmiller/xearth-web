"""Draw the app icons into public/icons/, and the Android launcher icons and splash images
if the Capacitor project exists (needs numpy and Pillow — the pipeline uses both).

    python scripts/make-icons.py

A globe lit from the upper left (day side with land and cloud, night side with city
lights, a thin atmosphere on the limb) inside a tilted cyan orbit ring carrying one
satellite, on dark space: the app in one picture. Drawn in layers — the ring's back half,
the globe, the ring's front half — at 4× and scaled down for clean edges. "any" icons fill
the square; the "maskable" one keeps everything in the central 80 % safe zone, since
Android crops it to a circle or squircle.
"""

import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
SPACE = np.array([4, 8, 15], float)
ACCENT = (98, 230, 255)
TILT = -0.42  # orbit ring tilt, radians


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def globe(s: int, R: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """RGB (0–255), coverage (0–1) and daylight (0–1) of the shaded globe, centred in an s×s square."""
    y, x = np.mgrid[0:s, 0:s].astype(float)
    nx, ny = (x - s / 2) / R, (y - s / 2) / R
    r2 = nx * nx + ny * ny
    cover = smoothstep(1.0 + 2 / R, 1.0 - 2 / R, np.sqrt(r2))
    nz = np.sqrt(np.clip(1 - r2, 0, 1))
    sun = np.array([-0.82, -0.3, 0.33])  # from the upper left, so the terminator crosses the disc
    sun /= np.linalg.norm(sun)
    k = nx * sun[0] + ny * sun[1] + nz * sun[2]
    day = smoothstep(-0.2, 0.3, k)
    lambert = np.clip(k, 0, 1)
    # Surface: ocean, a few land masses and cloud bands, placed on the sphere (lon/lat).
    lon, lat = np.arctan2(nx, nz), np.arcsin(np.clip(-ny, -1, 1))
    land = np.zeros_like(nx)
    for lo, la, a, b in [(-0.9, 0.35, 0.45, 0.32), (-0.55, -0.3, 0.28, 0.42), (0.35, 0.45, 0.5, 0.28), (0.55, -0.25, 0.25, 0.3)]:
        land = np.maximum(land, smoothstep(1.0, 0.75, ((lon - lo) / a) ** 2 + ((lat - la) / b) ** 2))
    cloud = np.zeros_like(nx)
    for lo, la, a, b in [(-0.4, 0.05, 0.9, 0.08), (-0.1, 0.55, 0.7, 0.07), (-0.7, -0.6, 0.6, 0.09)]:
        cloud = np.maximum(cloud, smoothstep(1.0, 0.4, ((lon - lo) / a) ** 2 + ((lat - la) / b) ** 2))
    ocean = np.array([30, 92, 170], float)
    green = np.array([72, 138, 86], float)
    surf = ocean * (1 - land[..., None]) + green * land[..., None]
    surf = surf * (1 - cloud[..., None] * 0.9) + np.array([235, 242, 250]) * cloud[..., None] * 0.9
    lit = surf * (0.35 + 0.75 * lambert)[..., None]
    night = np.array([9, 18, 36], float) * np.ones_like(surf)
    rgb = lit * day[..., None] + night * (1 - day[..., None])
    # Atmosphere: a thin blue limb, brighter on the sunlit side.
    limb = smoothstep(0.78, 1.0, np.sqrt(r2)) ** 2 * cover
    rgb += np.array([90, 150, 255]) * (limb * (0.06 + 0.94 * smoothstep(-0.3, 0.4, k)))[..., None] * 0.8
    return np.clip(rgb, 0, 255), cover, day


def ring_points(c: float, rx: float, ry: float, t0: float, t1: float, n=180):
    pts = []
    for i in range(n + 1):
        t = t0 + (t1 - t0) * i / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        pts.append((c + x * math.cos(TILT) - y * math.sin(TILT), c + x * math.sin(TILT) + y * math.cos(TILT)))
    return pts


def glow_layer(s: int, draw_fn) -> Image.Image:
    """RGBA: the shape plus a soft glow around it."""
    shape = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(shape))
    glow = shape.filter(ImageFilter.GaussianBlur(s * 0.012))
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out = Image.alpha_composite(out, Image.eval(glow, lambda v: v))
    return Image.alpha_composite(out, shape)


def draw(size: int, art: float) -> Image.Image:
    """`art`: fraction of the square the orbit ring spans."""
    s = size * 4
    c = s / 2
    rnd = random.Random(7)
    base = np.ones((s, s, 3)) * SPACE
    for _ in range(int(s * s / 7000)):  # stars
        x, y, b = rnd.randrange(s), rnd.randrange(s), rnd.randrange(80, 190)
        base[y, x] = (b, b, min(255, b + 25))
    img = Image.fromarray(base.astype(np.uint8), "RGB").convert("RGBA")
    rx, ry = s * art * 0.5, s * art * 0.16
    width = max(3, int(s * 0.014))
    # Back half of the ring (behind the globe).
    img = Image.alpha_composite(img, glow_layer(s, lambda d: d.line(ring_points(c, rx, ry, math.pi, 2 * math.pi), fill=ACCENT + (200,), width=width)))
    # The globe.
    R = s * art * 0.31
    rgb, cover, day = globe(s, R)
    g = Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")
    g.putalpha(Image.fromarray((cover * 255).astype(np.uint8), "L"))
    img = Image.alpha_composite(img, g)
    # City lights on the night side.
    d = ImageDraw.Draw(img)
    for _ in range(400):
        x, y = c + R * rnd.uniform(-0.9, 0.9), c + R * rnd.uniform(-0.9, 0.9)
        inside = (x - c) ** 2 + (y - c) ** 2 < (0.88 * R) ** 2
        if inside and day[int(y), int(x)] < 0.05 and rnd.random() < 0.35:
            q = s * 0.0035
            d.ellipse((x - q, y - q, x + q, y + q), fill=(255, 210, 130, 230))
    # Front half of the ring and the satellite on it.
    t = math.radians(38)
    sx = c + rx * math.cos(t) * math.cos(TILT) - ry * math.sin(t) * math.sin(TILT)
    sy = c + rx * math.cos(t) * math.sin(TILT) + ry * math.sin(t) * math.cos(TILT)
    rs = s * 0.036

    def front(dr: ImageDraw.ImageDraw):
        dr.line(ring_points(c, rx, ry, 0, math.pi), fill=ACCENT + (255,), width=width)
        dr.ellipse((sx - rs, sy - rs, sx + rs, sy + rs), fill=(232, 250, 255, 255))

    img = Image.alpha_composite(img, glow_layer(s, front))
    return img.convert("RGB").resize((size, size), Image.LANCZOS)


ANDROID_RES = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def android(res: Path) -> None:
    """Launcher icons (legacy, round, adaptive foreground) and splash images for the Capacitor app."""
    for name, k in DENSITIES.items():
        d = res / f"mipmap-{name}"
        if not d.exists():
            continue
        legacy = draw(round(48 * k), 0.9)
        legacy.save(d / "ic_launcher.png", optimize=True)
        mask = Image.new("L", legacy.size, 0)
        ImageDraw.Draw(mask).ellipse((0, 0, legacy.size[0] - 1, legacy.size[1] - 1), fill=255)
        round_icon = Image.new("RGBA", legacy.size, (0, 0, 0, 0))
        round_icon.paste(legacy, (0, 0), mask)
        round_icon.save(d / "ic_launcher_round.png", optimize=True)
        # Adaptive: a 108 dp layer the launcher masks; the art stays inside the central 66 dp.
        draw(round(108 * k), 0.58).save(d / "ic_launcher_foreground.png", optimize=True)
    colours = res / "values" / "ic_launcher_background.xml"
    if colours.exists():
        colours.write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            '    <color name="ic_launcher_background">#04080F</color>\n</resources>\n',
            encoding="utf-8",
        )
    for splash in res.glob("drawable*/splash.png"):
        w, h = Image.open(splash).size
        img = Image.new("RGB", (w, h), (0, 0, 0))
        icon = draw(max(64, round(min(w, h) * 0.32)), 0.92)
        img.paste(icon, ((w - icon.size[0]) // 2, (h - icon.size[1]) // 2))
        img.save(splash, optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        draw(size, 0.92).save(OUT / f"icon-{size}.png", optimize=True)
    draw(512, 0.72).save(OUT / "icon-maskable-512.png", optimize=True)
    draw(180, 0.86).save(OUT / "apple-touch-icon.png", optimize=True)
    print(f"wrote icons to {OUT}")
    if ANDROID_RES.exists():
        android(ANDROID_RES)
        print(f"wrote Android launcher icons and splash images to {ANDROID_RES}")


if __name__ == "__main__":
    main()
