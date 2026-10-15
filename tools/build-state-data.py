"""Builds extension/data/states.json: icon templates for recognising VALORANT screens without an ability bar.

menu: the seven icons of the game client's top navigation bar plus the settings gear (any language).
select: the four role filter buttons above the agent grid on the agent select screen.
Templates are cut from the reference crops in tools/state-refs/ and stored at half size, as the search runs there.
"""
import json, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'extension', 'data', 'states.json')

def cut(img, cx, cy, size, oy=0):
    x0, y0 = int(round(cx - size / 2)), int(round(cy - oy - size / 2))
    crop = img.crop((x0, y0, x0 + size, y0 + size)).resize((size // 2, size // 2), Image.BOX)
    return [int(v) for v in np.asarray(crop, np.uint8).ravel()]

menu = Image.open(os.path.join(HERE, 'state-refs', 'menu-bar.png'))
select = Image.open(os.path.join(HERE, 'state-refs', 'agent-select-filters.png'))
MENU_SIZE, SELECT_SIZE = 40, 60
menu_icons = [{'x': 262 + 78.5 * i, 'y': 24, 'anchor': 'left'} for i in range(7)] + [{'x': 1888, 'y': 25, 'anchor': 'right'}]
select_icons = [{'x': x, 'y': 252, 'anchor': 'left'} for x in (153, 232.5, 311.5, 391)]
data = {
    'menu': {'size': MENU_SIZE, 'need': 5, 'icons': [dict(i, t=cut(menu, i['x'], i['y'], MENU_SIZE)) for i in menu_icons]},
    'select': {'size': SELECT_SIZE, 'need': 3, 'icons': [dict(i, t=cut(select, i['x'], i['y'], SELECT_SIZE, oy=200)) for i in select_icons]},
}
# Keep the agent select word templates (made by tools/build-words.cjs).
if os.path.exists(OUT):
    old = json.load(open(OUT))
    if 'words' in old: data['words'] = old['words']
with open(OUT, 'w') as f:
    json.dump(data, f, separators=(',', ':'))
print(OUT, os.path.getsize(OUT), 'bytes')
