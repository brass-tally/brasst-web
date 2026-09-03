"""Rasterize the header ledger-glyph into favicon and PWA icons."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
CREDIT = (111, 203, 151, 255)  # --credit dark
DEBIT = (224, 112, 95, 255)  # --debit dark
BRASS = (224, 182, 90, 255)  # --brass dark
BG = (29, 38, 34, 255)  # --surface2 dark
BORDER = (42, 53, 48, 255)  # --line dark


def round_line(draw: ImageDraw.ImageDraw, p1, p2, width: float, color):
    w = max(1, int(round(width)))
    draw.line([p1, p2], fill=color, width=w)
    r = w / 2
    for x, y in (p1, p2):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def glyph(size: int, *, maskable: bool = False, border: bool = True) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG if maskable else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    inset = 0 if maskable else max(1, round(size * 0.02))
    radius = round((size - inset * 2) * (7 / 26))
    box = [inset, inset, size - 1 - inset, size - 1 - inset]
    draw.rounded_rectangle(box, radius=radius, fill=BG)
    if border and size >= 32 and not maskable:
        bw = max(1, round(size * 0.02))
        draw.rounded_rectangle(box, radius=radius, outline=BORDER, width=bw)

    # Header SVG is 15px in a 26px tile. Keep that padding so the bars match the nav glyph.
    pad = size * (5.5 / 26)
    scale = (size - 2 * pad) / 24

    def pt(x, y):
        return (pad + x * scale, pad + y * scale)

    stroke = 2.6 * scale
    round_line(draw, pt(4, 9.5), pt(15, 9.5), stroke, CREDIT)
    round_line(draw, pt(4, 15), pt(12, 15), stroke, DEBIT)
    round_line(draw, pt(18.5, 6.5), pt(17.1, 17.5), stroke, BRASS)
    return img


def save_png(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def main():
    landing = ROOT / "landing"
    app_pub = ROOT / "app" / "public"

    icon_32 = glyph(32)
    icon_180 = glyph(180)
    icon_192 = glyph(192)
    icon_512 = glyph(512)
    maskable = glyph(512, maskable=True, border=False)

    for dest in (landing, app_pub):
        save_png(icon_32, dest / "favicon-32.png")
        save_png(icon_180, dest / "apple-touch-icon.png")
        save_png(icon_192, dest / "icon-192.png")
        save_png(icon_512, dest / "icon-512.png")
        save_png(maskable, dest / "icon-maskable-512.png")
        ico_path = dest / "favicon.ico"
        glyph(48).save(
            ico_path,
            format="ICO",
            sizes=[(16, 16), (32, 32), (48, 48)],
        )

    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#1D2622"/>
  <g fill="none" stroke-linecap="round" stroke-width="2.6" transform="translate(4 4)">
    <path d="M4 9.5h11" stroke="#6FCB97"/>
    <path d="M4 15h8" stroke="#E0705F"/>
    <path d="M18.5 6.5l-1.4 11" stroke="#E0B65A"/>
  </g>
</svg>
"""
    (landing / "favicon.svg").write_text(svg, encoding="utf-8")
    (app_pub / "favicon.svg").write_text(svg, encoding="utf-8")
    print("wrote glyph icons")


if __name__ == "__main__":
    main()
