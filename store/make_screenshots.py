"""Turns two real screenshots of a swap into 1280x800 Chrome Web Store screenshots.

Run:  cd /c/Users/chand/twitch-ad-swap && python store/make_screenshots.py <first.webp> <second.webp>

Each picture keeps the Twitch top bar (with the AdSwap banner), the main player and the chat
column with the small player. The left sidebar (the viewer's own followed channels) is cut off,
and the chat messages, chat usernames and the viewer's avatar are blurred: the people in chat
did not agree to appear in a store listing. A caption band above explains what is happening.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1280, 800
INK = (15, 16, 18)
TEXT = (242, 244, 245)
SOFT = (154, 163, 168)
LIVE = (43, 196, 178)

# Where things are in each source picture (left, top, right, bottom), for the labels.
BOXES = [
    {'banner': (240, 9, 442, 33), 'small': (1734, 84, 1996, 233), 'player': (187, 41, 1730, 634)},
    {'banner': (242, 9, 444, 33), 'small': (1734, 84, 1996, 233), 'player': (190, 41, 1733, 634)},
]

CAPTIONS = [
    ('The live stream stays in the big player during ad breaks.',
     'The ad moves to the small player above chat, muted. AdSwap switches back by itself when the break ends.'),
    ('Watch the stream with sound while the ad plays on mute.',
     "Twitch's own volume slider, fullscreen and theatre buttons keep working. The banner in the top bar shows what AdSwap is doing."),
]


def font(name, size):
    return ImageFont.truetype(name, size)


def blur(im, box, radius=9):
    region = im.crop(box).filter(ImageFilter.GaussianBlur(radius))
    im.paste(region, box)


def wrap(draw, text, f, width):
    words, lines, line = text.split(), [], ''
    for w in words:
        test = (line + ' ' + w).strip()
        if draw.textlength(test, font=f) <= width:
            line = test
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def make(src, out, caption, boxes):
    im = Image.open(src).convert('RGB')
    sw, sh = im.size
    # Chat: everything under the "Stream Chat" header (usernames, messages, the gift leaderboard).
    blur(im, (1734, 262, sw, sh))
    # The viewer's own avatar, top right.
    blur(im, (sw - 46, 0, sw, 40), 6)
    # Keep the top bar, the player and the chat column; drop the left sidebar.
    crop = im.crop((186, 0, sw, sh))
    scale = W / crop.width
    shot = crop.resize((W, round(crop.height * scale)), Image.LANCZOS)

    page = Image.new('RGB', (W, H), INK)
    band = H - shot.height
    page.paste(shot, (0, band))
    d = ImageDraw.Draw(page)
    # a thin teal rule between the caption and the picture
    d.rectangle([0, band - 3, W, band - 1], fill=LIVE)

    head, sub = caption
    fh, fs = font('segoeuib.ttf', 40), font('segoeui.ttf', 22)
    x = 56
    lines_h = wrap(d, head, fh, W - 2 * x)
    lines_s = wrap(d, sub, fs, W - 2 * x)
    total = len(lines_h) * 50 + 14 + len(lines_s) * 31
    y = (band - total) // 2
    d.text((x, y - 2), 'AdSwap', font=font('segoeuib.ttf', 18), fill=LIVE)
    y += 22
    for line in lines_h:
        d.text((x, y), line, font=fh, fill=TEXT)
        y += 50
    y += 6
    for line in lines_s:
        d.text((x, y), line, font=fs, fill=SOFT)
        y += 31
    # Labels: what is the live stream, what is the ad, and where AdSwap's banner is.
    def at(box):
        l, t, r, b = box
        return ((l - 186) * scale, band + t * scale, (r - 186) * scale, band + b * scale)

    ft = font('segoeuib.ttf', 15)

    def tag(xy, words, fill, ink):
        x0, y0 = xy
        w = d.textlength(words, font=ft)
        d.rounded_rectangle([x0, y0, x0 + w + 18, y0 + 26], radius=6, fill=fill)
        d.text((x0 + 9, y0 + 3), words, font=ft, fill=ink)

    l, t, r, b = at(boxes['small'])
    d.rounded_rectangle([l - 2, t - 2, r + 1, b + 1], radius=5, outline=LIVE, width=3)
    tag((l + 6, b + 8), 'The ad, muted', LIVE, INK)
    l, t, r, b = at(boxes['player'])
    tag((l + 10, t + 30), 'The live stream, with sound', LIVE, INK)
    l, t, r, b = at(boxes['banner'])
    d.rounded_rectangle([l - 3, t - 3, r + 3, b + 3], radius=5, outline=LIVE, width=2)
    tag((r + 12, t - 2), "← AdSwap's status banner", (32, 35, 39), TEXT)

    page.save(out)
    print('wrote', os.path.relpath(out, os.path.dirname(HERE)), page.size, 'picture', shot.size, 'caption band', band)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    for i, src in enumerate(sys.argv[1:3]):
        make(src, os.path.join(HERE, 'screenshot-%d-1280x800.png' % (i + 1)), CAPTIONS[i], BOXES[i])
