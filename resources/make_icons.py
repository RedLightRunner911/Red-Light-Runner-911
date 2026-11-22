# Regenerates every app icon, splash screen and store graphic from the shield logo below.
# Run from the repo root:  pip install cairosvg pillow  then  python resources/make_icons.py
import io, os
import cairosvg
from PIL import Image

NAVY = '#0B1830'     # icon background (also android/.../values/ic_launcher_background.xml)
SHIELD = '#1E3A6E'
EDGE = '#4FC3F7'
RED = '#EF4444'
R = 'android/app/src/main/res'

def logo(color=True):
    """Shield logo drawn in a 100x100 box."""
    if color:
        shield = f'<path d="M50 6 L88 19 L88 50 C88 76 71 90 50 98 C29 90 12 76 12 50 L12 19 Z" fill="{SHIELD}" stroke="{EDGE}" stroke-width="5" stroke-linejoin="round"/>'
        ink, dot = '#FFFFFF', RED
    else:  # monochrome: one color only, Android tints it
        shield = '<path d="M50 6 L88 19 L88 50 C88 76 71 90 50 98 C29 90 12 76 12 50 L12 19 Z" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="round"/>'
        ink, dot = '#FFFFFF', '#FFFFFF'
    arcs = ''.join(f'<path d="M{50-r*0.7071:.2f} {70-r*0.7071:.2f} A{r} {r} 0 0 1 {50+r*0.7071:.2f} {70-r*0.7071:.2f}" fill="none" stroke="{ink}" stroke-width="7" stroke-linecap="round"/>' for r in (12, 23, 34))
    return shield + arcs + f'<circle cx="50" cy="72" r="6" fill="{dot}"/>'

def place(size, frac, color=True):
    s = size * frac / 100
    x = (size - size * frac) / 2
    return f'<g transform="translate({x:.3f} {x:.3f}) scale({s:.5f})">{logo(color)}</g>'

def render(svgtext, w, h, path, fmt='PNG'):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    png = cairosvg.svg2png(bytestring=svgtext.encode(), output_width=w, output_height=h)
    im = Image.open(io.BytesIO(png))
    if fmt == 'JPEG':
        im.convert('RGB').save(path, 'JPEG', quality=95)
    else:
        im.save(path, 'PNG')

def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>'

def tile(size, frac, shape='rounded'):
    if shape == 'square':
        bg = f'<rect width="{size}" height="{size}" fill="{NAVY}"/>'
    elif shape == 'circle':
        bg = f'<circle cx="{size/2}" cy="{size/2}" r="{size/2}" fill="{NAVY}"/>'
    else:
        bg = f'<rect width="{size}" height="{size}" rx="{size*0.18}" fill="{NAVY}"/>'
    return svg(size, size, bg + place(size, frac))

DENSITY = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for d, k in DENSITY.items():
    p = f'{R}/mipmap-{d}'
    leg, fg = round(48 * k), round(108 * k)
    render(tile(leg, 0.78), leg, leg, f'{p}/ic_launcher.png')
    render(tile(leg, 0.72, 'circle'), leg, leg, f'{p}/ic_launcher_round.png')
    # Adaptive layers: logo inside the 66/108 safe zone, transparent around it.
    render(svg(fg, fg, place(fg, 0.56)), fg, fg, f'{p}/ic_launcher_foreground.png')
    render(svg(fg, fg, place(fg, 0.56, color=False)), fg, fg, f'{p}/ic_launcher_monochrome.png')

with open(f'{R}/values/ic_launcher_background.xml', 'w') as f:
    f.write(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{NAVY}</color>\n</resources>\n')

# Splash screens: navy with the logo in the middle.
for d in sorted(os.listdir(R)):
    sp = f'{R}/{d}/splash.png'
    if os.path.exists(sp):
        w, h = Image.open(sp).size
        size = min(w, h) * 0.32
        body = f'<rect width="{w}" height="{h}" fill="{NAVY}"/><g transform="translate({(w-size)/2:.2f} {(h-size)/2:.2f}) scale({size/100:.5f})">{logo()}</g>'
        render(svg(w, h, body), w, h, sp)

# Store and web icons.
render(tile(512, 0.74, 'square'), 512, 512, 'docs/play-store/icon-512.png')
for s in (192, 512):
    render(tile(s, 0.74, 'square'), s, s, f'public/icons/icon-{s}.png')
render(tile(512, 0.56, 'square'), 512, 512, 'public/icons/maskable-512.png')
render(tile(180, 0.74, 'square'), 180, 180, 'public/icons/apple-touch-icon.png')
render(tile(64, 0.86), 64, 64, 'public/favicon.png')

# Play Store feature graphic.
fg_body = (f'<rect width="1024" height="500" fill="{NAVY}"/>'
           f'<g transform="translate(640 60) scale(3.8)">{logo()}</g>'
           '<text x="64" y="230" font-family="Inter" font-weight="700" font-size="84" fill="#FFFFFF">Police Radar</text>'
           '<text x="66" y="300" font-family="Inter" font-size="30" fill="#B8C6DC">Passive police-gear awareness map</text>'
           '<text x="66" y="345" font-family="Inter" font-size="30" fill="#B8C6DC">Free. Private. Nothing uploaded.</text>')
render(svg(1024, 500, fg_body), 1024, 500, 'docs/play-store/feature-graphic-1024x500.png')

# Source image (kept so nothing regenerates the old logo).
render(tile(1024, 0.74, 'square'), 1024, 1024, 'resources/icon-source.jpg', 'JPEG')
print('Icons regenerated.')
