"""Builds stat230-notebook-scanned.pdf: a GoodNotes-style handwritten notebook, exported the way
a scan looks (one JPEG per page, lined paper, slight tilt, grain), with no text layer.

    python tests/fixtures/files/make-scanned-notebook.py

Needs Pillow and the Windows handwriting fonts Ink Free and Segoe Print. The page text lives in
stat230-notebook.json, which the recorded transcriptions in tests/fixtures/ai/ follow.
"""
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
FONTS = ["C:/Windows/Fonts/Inkfree.ttf", "C:/Windows/Fonts/segoepr.ttf"]
W, H = 1275, 1650  # US Letter at 150 dpi
LINE = 56
TOP = 190


def page_image(spec: dict, index: int) -> Image.Image:
    rnd = random.Random(230 + index)
    img = Image.new("RGB", (W, H), (252, 250, 243))
    d = ImageDraw.Draw(img)
    for y in range(TOP, H - 80, LINE):
        d.line([(60, y), (W - 60, y)], fill=(196, 214, 232), width=2)
    d.line([(150, 60), (150, H - 60)], fill=(232, 170, 170), width=2)

    head = ImageFont.truetype(FONTS[1], 44)
    body = ImageFont.truetype(FONTS[0], 40)
    d.text((170, TOP - 62), spec["heading"], font=head, fill=(20, 40, 120))
    y = TOP + LINE + 8
    for line in spec["lines"]:
        x = 175 + rnd.randint(-6, 10)
        d.text((x, y - 44 + rnd.randint(-3, 3)), line, font=body, fill=(24, 24, 28))
        y += LINE
    if spec.get("venn"):
        cy = y + 160
        d.ellipse([300, cy - 120, 560, cy + 120], outline=(24, 24, 28), width=4)
        d.ellipse([460, cy - 120, 720, cy + 120], outline=(24, 24, 28), width=4)
        d.text((360, cy - 20), "A", font=body, fill=(24, 24, 28))
        d.text((640, cy - 20), "B", font=body, fill=(24, 24, 28))
    d.text((W - 160, H - 90), str(index + 1), font=body, fill=(90, 90, 90))

    # Scan look: tilt, grain, soften.
    img = img.rotate(rnd.uniform(-0.8, 0.8), resample=Image.BICUBIC, fillcolor=(236, 234, 228))
    noise = Image.effect_noise((W, H), 9).convert("RGB")
    img = Image.blend(img, noise, 0.06)
    return img.filter(ImageFilter.GaussianBlur(0.5))


def main() -> None:
    spec = json.loads((HERE / "stat230-notebook.json").read_text(encoding="utf-8"))
    pages = [page_image(p, i) for i, p in enumerate(spec["pages"])]
    out = HERE / "stat230-notebook-scanned.pdf"
    pages[0].save(out, "PDF", save_all=True, append_images=pages[1:], resolution=150.0, quality=70)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB, {len(pages)} pages)")


if __name__ == "__main__":
    main()
