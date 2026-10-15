#!/usr/bin/env python3
"""Rebuilds extension/data/agents.json, extension/data/icons.bin and the agent and role pictures from
valorant-api.com (a community mirror of the game's assets). Run it when Riot releases a new agent.

    python3 tools/build-agent-data.py

Needs Python 3 with Pillow, OpenCV (cv2) and numpy, and network access to valorant-api.com.
The detector compares each ability icon's alpha channel, so icons are stored as 64x64 alpha masks."""
import io, json, os, urllib.request
import cv2, numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'extension')
SLOTS = ['Grenade', 'Ability1', 'Ability2', 'Ultimate']
N = 64

def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()

agents = json.loads(get('https://valorant-api.com/v1/agents?isPlayableCharacter=true'))['data']
agents.sort(key=lambda a: a['displayName'])
out, blob, portraits = [], bytearray(), bytearray()
os.makedirs(os.path.join(ROOT, 'img/agents'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'img/roles'), exist_ok=True)
roles = {}
for a in agents:
    key = a['displayName'].replace('/', '').lower()
    icons = []
    for slot in SLOTS:
        ability = next(x for x in a['abilities'] if x['slot'] == slot)
        img = cv2.imdecode(np.frombuffer(get(ability['displayIcon']), np.uint8), cv2.IMREAD_UNCHANGED)
        alpha = cv2.resize(img[:, :, 3], (N, N), interpolation=cv2.INTER_AREA)
        icons.append({'slot': slot, 'offset': len(blob)})
        blob += alpha.tobytes()
    full = Image.open(io.BytesIO(get(a['displayIcon']))).convert('RGBA')
    full.resize((96, 96), Image.LANCZOS).save(os.path.join(ROOT, f'img/agents/{key}.webp'), 'WEBP', quality=88, method=6)
    # The same picture appears bottom-left while spectating a teammate: kept as 64x64 grey + alpha.
    rgba = cv2.resize(cv2.cvtColor(np.array(full), cv2.COLOR_RGBA2BGRA), (N, N), interpolation=cv2.INTER_AREA)
    portrait_offset = len(portraits)
    portraits += cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_BGR2GRAY).tobytes() + rgba[:, :, 3].tobytes()
    colors = ['#' + c[:6] for c in (a.get('backgroundGradientColors') or [])]
    out.append({'id': key, 'name': a['displayName'], 'role': a['role']['displayName'], 'uuid': a['uuid'],
                'icons': icons, 'portrait': portrait_offset, 'color': colors[0] if colors else '#888888', 'colors': colors})
    roles[a['role']['displayName']] = a['role']['displayIcon']
for name, url in roles.items():
    im = Image.open(io.BytesIO(get(url))).convert('RGBA'); im.thumbnail((64, 64))
    im.save(os.path.join(ROOT, f'img/roles/{name.lower()}.png'), optimize=True)
open(os.path.join(ROOT, 'data/icons.bin'), 'wb').write(bytes(blob))
open(os.path.join(ROOT, 'data/portraits.bin'), 'wb').write(bytes(portraits))
json.dump({'size': N, 'portraitSize': N, 'agents': out}, open(os.path.join(ROOT, 'data/agents.json'), 'w'), indent=1)
print(f'{len(out)} agents written')
