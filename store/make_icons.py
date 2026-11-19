"""Draws the Ad Swap logo and writes the icon sizes Chrome needs.

Run:  cd /c/Users/chand/twitch-ad-swap && python store/make_icons.py

The picture: a big screen (the live stream, bright, with a play mark) and a small screen
tucked in its corner (the ad, grey). Two arrows between them say "these two swap".
Original artwork: no Twitch logo, shapes or wordmark.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SS = 8  # draw 8x too big, then shrink: smooth edges

TILE = (24, 24, 27, 255)        # near-black tile
STREAM = (45, 212, 191, 255)    # teal: the live stream
STREAM_DARK = (15, 118, 110, 255)
AD = (113, 113, 122, 255)       # grey: the ad
WHITE = (250, 250, 250, 255)


def draw(size, pad_frac, detail, full_bleed=False, ss=SS):
    """size: final pixels. pad_frac: margin as a fraction. detail: draw the arrows.
    full_bleed: fill the whole square with the tile colour (for profile pictures, which
    get cropped to a circle) instead of drawing a rounded tile on a clear background."""
    n = size * ss
    img = Image.new('RGBA', (n, n), TILE if full_bleed else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = n * pad_frac
    a = n - 2 * pad                       # artwork edge length

    def P(x, y):                          # artwork coordinates 0..1 -> pixels
        return (pad + x * a, pad + y * a)

    def box(x0, y0, x1, y1, r, fill, outline=None, width=0):
        d.rounded_rectangle([P(x0, y0), P(x1, y1)], radius=r * a, fill=fill,
                            outline=outline, width=int(width * a))

    if not full_bleed:
        box(0, 0, 1, 1, 0.20, TILE)                               # tile
    box(0.10, 0.17, 0.82, 0.64, 0.07, STREAM)                     # big screen = stream
    d.polygon([P(0.37, 0.29), P(0.37, 0.52), P(0.57, 0.405)], fill=WHITE)   # play mark
    box(0.50, 0.50, 0.92, 0.84, 0.065, TILE)                      # dark rim so the small screen reads
    box(0.535, 0.535, 0.885, 0.805, 0.045, AD)                    # small screen = ad

    if detail:
        # two arrows, bottom-left: one pointing right, one pointing left = swap
        w = int(0.035 * a)
        for (x0, x1, y, head) in ((0.12, 0.40, 0.735, 1), (0.12, 0.40, 0.845, -1)):
            d.line([P(x0, y), P(x1, y)], fill=WHITE, width=w)
            tip = x1 if head == 1 else x0
            back = tip - head * 0.075
            d.polygon([P(tip + head * 0.02, y), P(back, y - 0.055), P(back, y + 0.055)], fill=WHITE)
            # round the tail
            tail = x0 if head == 1 else x1
            r = w / 2
            cx, cy = P(tail, y)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


def tile(w, h):
    """Small promo tile for the store: logo on the left, name on the right."""
    from PIL import ImageFont
    img = Image.new('RGBA', (w * 2, h * 2), TILE)
    logo = draw(int(h * 2 * 0.52), 0.0, True)
    img.alpha_composite(logo, (int(w * 2 * 0.06), int((h * 2 - logo.height) / 2)))
    d = ImageDraw.Draw(img)
    def font(px, bold=True):
        for name in (('segoeuib.ttf', 'arialbd.ttf') if bold else ('segoeui.ttf', 'arial.ttf')):
            try:
                return ImageFont.truetype(name, px)
            except OSError:
                pass
        return ImageFont.load_default()
    x = int(w * 2 * 0.06) + logo.width + int(w * 2 * 0.05)
    d.text((x, int(h * 2 * 0.31)), 'Ad Swap', font=font(int(h * 2 * 0.17)), fill=WHITE)
    d.text((x, int(h * 2 * 0.56)), 'Watch the stream,', font=font(int(h * 2 * 0.085), False), fill=STREAM)
    d.text((x, int(h * 2 * 0.67)), 'not the ad break.', font=font(int(h * 2 * 0.085), False), fill=STREAM)
    return img.resize((w, h), Image.LANCZOS).convert('RGB')


if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'icons'), exist_ok=True)
    # 128: the store wants 96px of artwork with 16px clear on each side.
    draw(128, 16 / 128, True).save(os.path.join(ROOT, 'icons', 'icon128.png'))
    draw(48, 0.04, True).save(os.path.join(ROOT, 'icons', 'icon48.png'))
    draw(32, 0.0, False).save(os.path.join(ROOT, 'icons', 'icon32.png'))
    draw(16, 0.0, False).save(os.path.join(ROOT, 'icons', 'icon16.png'))
    draw(512, 16 / 128, True).save(os.path.join(HERE, 'logo-512.png'))
    tile(440, 280).save(os.path.join(HERE, 'promo-small-440x280.png'))
    # Profile picture (Cash App, Venmo, anywhere that crops to a circle): square, no clear
    # corners, artwork kept well inside the circle.
    draw(1024, 0.15, True, full_bleed=True, ss=4).convert('RGB').save(os.path.join(HERE, 'profile-picture-1024.png'))
    print('icons written')
