#!/usr/bin/env python3
"""Moon Bot's icons from one source, assets/art/moon-sprite.png (the lilac moon sprite,
cut out with alpha). Writes the app tile in light and dark at 16 to 1024 px
(assets/icons/), assets/icon.png (1024), assets/icon.ico (16 to 256), assets/icon.icns,
and core/src/client/brand-art.js: the tile and the sprite as data URLs for the UI.
Small sizes are sharpened after the downscale so the face stays legible.
Run: python3 scripts/icon.py  (needs Pillow and NumPy)."""
import base64, io, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ASSETS = os.path.join(APP, 'assets')
CLIENT = os.path.join(os.path.dirname(APP), '..', 'packages', 'core', 'src', 'client')
SPRITE = Image.open(os.path.join(ASSETS, 'art', 'moon-sprite.png')).convert('RGBA')
SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024]
# Tile backgrounds, top to bottom: warm cream to pale lilac; deep plum at night.
LIGHT = ((253, 248, 244), (242, 232, 246))
DARK = ((44, 34, 58), (26, 20, 36))


def sharpen(image, px):
    if px <= 32:
        return image.filter(ImageFilter.UnsharpMask(radius=0.6, percent=90, threshold=1))
    if px <= 64:
        return image.filter(ImageFilter.UnsharpMask(radius=0.9, percent=60, threshold=1))
    return image


def sized(image, px):
    return sharpen(image.resize((px, px), Image.LANCZOS), px)


def tile(px, dark):
    big = min(px * 4, 2048)
    top, bottom = DARK if dark else LIGHT
    pixels = np.zeros((big, big, 4), 'uint8')
    for channel in range(3):
        pixels[..., channel] = np.linspace(top[channel], bottom[channel], big)[:, None].astype('uint8')
    pixels[..., 3] = 255
    shape = Image.new('L', (big, big), 0)
    ImageDraw.Draw(shape).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.225), fill=255)
    out = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    out.paste(Image.fromarray(pixels), (0, 0), shape)
    side = int(big * 0.80)
    out.alpha_composite(SPRITE.resize((side, side), Image.LANCZOS), ((big - side) // 2, int(big * 0.11)))
    if not dark:
        ImageDraw.Draw(out).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.225), outline=(0, 0, 0, 18), width=4)
    return sized(out, px)


def data_url(image, fmt='WEBP'):
    buffer = io.BytesIO()
    image.save(buffer, fmt, quality=90, method=6) if fmt == 'WEBP' else image.save(buffer, fmt)
    return f"data:image/{fmt.lower()};base64,{base64.b64encode(buffer.getvalue()).decode()}"


def main():
    icons = os.path.join(ASSETS, 'icons')
    os.makedirs(icons, exist_ok=True)
    for px in SIZES:
        tile(px, False).save(os.path.join(icons, f'moon-bot-{px}.png'))
        tile(px, True).save(os.path.join(icons, f'moon-bot-dark-{px}.png'))
    for px in [24, 48, 96, 192]:
        sized(SPRITE, px).save(os.path.join(icons, f'sprite-{px}.png'))
    tile(1024, False).save(os.path.join(ASSETS, 'icon.png'))
    tile(256, False).save(os.path.join(ASSETS, 'icon.ico'), sizes=[(s, s) for s in [16, 24, 32, 48, 64, 128, 256]])
    tile(1024, False).save(os.path.join(ASSETS, 'icon.icns'))
    with open(os.path.join(CLIENT, 'brand-art.js'), 'w') as file:
        file.write('// Written by app/scripts/icon.py from app/assets/art/moon-sprite.png; do not edit.\n')
        file.write('// The Moon Bot tile (light, dark) and the Main Bot\'s sprite, as data URLs.\n')
        file.write(f"export const LOGO_LIGHT = '{data_url(tile(96, False))}'\n")
        file.write(f"export const LOGO_DARK = '{data_url(tile(96, True))}'\n")
        file.write(f"export const FAVICON = '{data_url(tile(64, False), 'PNG')}'\n")
        file.write(f"export const SPRITE = '{data_url(sized(SPRITE, 192))}'\n")
    print('icon: wrote assets/icons/*, assets/icon.png, icon.ico, icon.icns and core/src/client/brand-art.js')


if __name__ == '__main__':
    main()
