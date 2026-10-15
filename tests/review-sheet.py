# Contact sheet of live decisions: each preview's ability bar and score area, labelled with what Agent Lens decided.
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
here=os.path.dirname(os.path.abspath(__file__)); shots=os.path.join(here,'shots')
d=json.load(open(os.path.join(shots,'live-decisions.json')))
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',18)
W,H=700,250
items=d['list']; rows=(len(items)+1)//2
sheet=Image.new('RGB',(W*2,H*rows),(10,10,12)); dr=ImageDraw.Draw(sheet)
for i,b in enumerate(items):
    x,y=(i%2)*W,(i//2)*H
    p=os.path.join(shots,'live-previews',b['login']+'.jpg')
    try:
        im=Image.open(p).convert('RGB')
        if im.size!=(1920,1080): im=im.resize((1920,1080))
        sheet.paste(im.crop((560,0,1360,80)).resize((700,70)),(x,y)); sheet.paste(im.crop((560,950,1360,1060)).resize((700,96)),(x,y+70)); sheet.paste(im.crop((0,780,420,890)).resize((350,92)),(x,y+166))
    except Exception as e: dr.text((x+10,y+40),str(e)[:60],fill='red')
    dr.text((x+360,y+200),f"{i:02d} {b['login'][:20]} -> {b['text'] or 'no agent'}",fill=(140,255,190) if b['text'] else (200,200,200),font=font)
sheet.save(os.path.join(shots,'live-review.png')); print(len(items))
