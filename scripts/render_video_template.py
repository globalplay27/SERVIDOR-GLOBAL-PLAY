"""Five-part customer template; movie artwork and all copy stay data-driven."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter

W, H = 1080, 1920
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/video-template'

def font(size, bold=False):
    for path in [os.getenv('NEXUS_FONT', ''), f'/usr/share/fonts/truetype/dejavu/DejaVuSans{"-Bold" if bold else ""}.ttf', f'C:/Windows/Fonts/arial{"bd" if bold else ""}.ttf']:
        if path and Path(path).exists():
            return ImageFont.truetype(path, size)
    raise RuntimeError('render_font_missing')

def lines(draw, text, face, width):
    result, line = [], ''
    for word in str(text).split():
        candidate = (line + ' ' + word).strip()
        if draw.textlength(candidate, font=face) > width and line:
            result.append(line)
            line = word
        else:
            line = candidate
    if line:
        result.append(line)
    return result

def text_block(draw, text, box, size=30, bold=False, fill='white', centered=False):
    x,y,right,bottom = box
    while size >= 16:
        face = font(size,bold)
        wrapped = lines(draw,text,face,right-x)
        spacing = round(size*1.3)
        if len(wrapped)*spacing <= bottom-y:
            break
        size -= 1
    if len(wrapped)*spacing > bottom-y:
        raise ValueError('text_does_not_fit')
    for line in wrapped:
        at = x+(right-x-draw.textlength(line,font=face))/2 if centered else x
        draw.text((at,y),line,font=face,fill=fill)
        y += spacing
    return y

def rounded_image(canvas, image, box, radius=35, cover=True):
    x,y,r,b = box
    size=(r-x,b-y)
    image=ImageOps.fit(image.convert('RGB'),size) if cover else ImageOps.pad(image.convert('RGB'),size,color='#05080c')
    mask=Image.new('L',size)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,size[0]-1,size[1]-1),radius,fill=255)
    canvas.paste(image,(x,y),mask)

def background(poster):
    image=ImageOps.fit(poster.convert('RGB'),(W,H)).convert('RGBA').filter(ImageFilter.GaussianBlur(13))
    image=Image.alpha_composite(image,Image.new('RGBA',(W,H),(1,9,16,205)))
    return image

def contact_icon(canvas):
    d=ImageDraw.Draw(canvas)
    x,y=318,1814
    d.ellipse((x-45,y-45,x+45,y+45),fill='#25d366',outline='white',width=5)
    d.polygon([(x-38,y+26),(x-45,y+51),(x-12,y+40)],fill='#25d366')
    d.line([(x-38,y+26),(x-45,y+51),(x-12,y+40)],fill='white',width=4)
    # White handset within the chat bubble.
    d.arc((x-24,y-25,x+26,y+23),70,205,fill='white',width=11)
    d.rounded_rectangle((x-28,y-24,x-12,y-5),5,fill='white')
    d.rounded_rectangle((x+10,y+6,x+28,y+22),5,fill='white')

def heart_eyes(canvas):
    d=ImageDraw.Draw(canvas); x,y=485,878
    d.ellipse((x-62,y-62,x+62,y+62),fill='#ffcb37')
    for cx in [x-27,x+27]:
        d.ellipse((cx-20,y-33,cx,y-13),fill='#f04465')
        d.ellipse((cx,y-33,cx+20,y-13),fill='#f04465')
        d.polygon([(cx-20,y-23),(cx+20,y-23),(cx,y+3)],fill='#f04465')
    d.arc((x-29,y-4,x+29,y+37),0,180,fill='#63221a',width=9)

def footer(canvas, contact=''):
    d=ImageDraw.Draw(canvas)
    d.rectangle((0,1738,W,H),fill=(1,7,11,240))
    text_block(d,os.getenv('END_TEXT') or 'DISPONÍVEL EM NOSSO APLICATIVO',(100,1748,980,1790),27,centered=True)
    # The same six device categories as the reference, drawn as editable vectors.
    labels=['TV SMART','TV BOX','PC/NOTE','CELULAR','XBOX','CAST']
    for i,label in enumerate(labels):
        x=200+i*130
        if i in (0,1,2):
            d.rounded_rectangle((x-42,1800,x+42,1850),5,outline='white',width=3)
            d.line((x-12,1851,x+12,1851),fill='white',width=3)
        elif i==3:
            d.rounded_rectangle((x-20,1793,x+20,1856),5,outline='white',width=3)
            d.line((x-7,1848,x+7,1848),fill='white',width=2)
        elif i==4:
            d.ellipse((x-32,1793,x+32,1857),outline='white',width=3)
            d.line((x-22,1803,x+22,1847),fill='white',width=3)
            d.line((x+22,1803,x-22,1847),fill='white',width=3)
        else:
            d.rounded_rectangle((x-36,1799,x+36,1855),5,outline='white',width=3)
            for radius in (12,22,32):
                d.arc((x-42-radius,1835-radius,x-42+radius,1835+radius),270,360,fill='white',width=3)
        text_block(d,label,(x-60,1867,x+60,1898),17,centered=True)
    contact_icon(canvas)
    if contact:
        text_block(d,contact,(65,1692,1015,1736),26,centered=True)

def prepare(work, metadata, poster_path=None):
    work=Path(work); work.mkdir(parents=True,exist_ok=True)
    folder=Path(metadata['_folder'])
    poster=Image.open(poster_path or folder/metadata['poster']).convert('RGB')
    required=['title','overview','cast','reviews','related']
    if any(not metadata.get(field) for field in required):
        raise ValueError('movie_metadata_incomplete')
    bg=background(poster)
    bg.save(work/'background.png')
    contact=os.getenv('END_CONTACT','')

    intro=bg.copy()
    intro.paste(ImageOps.fit(poster,(W,650),centering=(.5,.18)),(0,0))
    # Generated transparent frame is mapped to the reference's original phone bounds.
    hand=Image.open(ASSETS/'phone-hand.webp').convert('RGBA')
    hand=hand.resize((846,1538),Image.Resampling.LANCZOS)
    screen=(281,518,773,1558)
    ImageDraw.Draw(intro).rounded_rectangle(screen,48,fill='#02060b')
    rounded_image(intro,poster,(281,518,773,1256),48)
    shade=Image.new('RGBA',(492,1040))
    sd=ImageDraw.Draw(shade)
    for y in range(1040):
        alpha=max(0,min(245,round((y-610)*.75)))
        sd.line((0,y,491,y),fill=(0,0,0,alpha))
    intro.alpha_composite(shade,(281,518))
    intro.alpha_composite(hand,(60,370))
    d=ImageDraw.Draw(intro)
    text_block(d,metadata['title'],(312,1258,748,1308),36,True,centered=True)
    text_block(d,' • '.join(filter(None,[metadata.get('year'),metadata.get('runtime')])),(310,1320,747,1360),23,centered=True)
    text_block(d,metadata['overview'],(311,1370,747,1528),25,centered=True)
    footer(intro,contact)
    intro.save(work/'phase-0.png')

    launch=bg.copy(); d=ImageDraw.Draw(launch)
    text_block(d,metadata.get('media_type','FILME'),(100,586,510,635),31,centered=True)
    for j,word in enumerate(['LAN','ÇA','MEN','TO']):
        text_block(d,word,(100,650+j*130,550,790+j*130),110,True,centered=True)
    heart_eyes(launch)
    glow=Image.new('RGBA',(W,H)); ImageDraw.Draw(glow).rounded_rectangle((612,592,1028,1268),40,outline='white',width=15)
    launch.alpha_composite(glow.filter(ImageFilter.GaussianBlur(14)))
    rounded_image(launch,poster,(620,600,1020,1260),35)
    d.rounded_rectangle((620,600,1020,1260),35,outline='white',width=4)
    text_block(d,metadata['title'],(100,1320,580,1420),31,True)
    text_block(d,' • '.join(filter(None,[metadata.get('year'),metadata.get('genres'),metadata.get('runtime'),metadata.get('rating')])),(100,1425,580,1495),20)
    text_block(d,metadata['overview'],(100,1500,550,1700),24)
    popcorn=Image.open(ASSETS/'popcorn.webp').convert('RGBA')
    popcorn.thumbnail((640,740),Image.Resampling.LANCZOS)
    launch.alpha_composite(popcorn,(550,1195))
    footer(launch,contact)
    launch.save(work/'phase-1.png')

    cast=bg.copy(); d=ImageDraw.Draw(cast)
    for i,person in enumerate(metadata['cast'][:9]):
        cx=195+(i%3)*345; cy=750+(i//3)*425
        image=ImageOps.fit(Image.open(folder/person['image']).convert('RGB'),(250,250),centering=(.5,.25))
        mask=Image.new('L',(250,250)); ImageDraw.Draw(mask).ellipse((0,0,249,249),fill=255)
        glow=Image.new('RGBA',(W,H)); ImageDraw.Draw(glow).ellipse((cx-141,cy-141,cx+141,cy+141),fill='white')
        cast.alpha_composite(glow.filter(ImageFilter.GaussianBlur(9)))
        d.ellipse((cx-140,cy-140,cx+140,cy+140),fill='white')
        cast.paste(image,(cx-125,cy-125),mask)
        text_block(d,person['name'],(cx-150,cy+153,cx+150,cy+257),36,True,centered=True)
    contact_icon(cast)
    cast.save(work/'phase-2.png')

    reviews=bg.copy(); d=ImageDraw.Draw(reviews)
    for i,review in enumerate(metadata['reviews'][:3]):
        y=660+i*340
        points=[]
        for j in range(32):
            x=100+j*28
            points.append((x,y+(12 if j%2 else -7)))
        points += [(970-j*28,y+280+(10 if j%2 else -7)) for j in range(32)]
        d.polygon(points,fill='#e0c7ff')
        d.ellipse((145,y+30,215,y+100),fill='#5c91ed')
        text_block(d,review['author'],(240,y+27,900,y+70),27,True,fill='#17202c')
        text_block(d,review.get('source',''),(240,y+67,900,y+100),18,fill='#333545')
        text_block(d,review['text'],(145,y+119,925,y+230),28,fill='#17202c')
        text_block(d,'Síntese em português',(145,y+244,925,y+275),17,fill='#51425b')
    footer(reviews,contact)
    reviews.save(work/'phase-3.png')

    related=bg.copy(); d=ImageDraw.Draw(related)
    text_block(d,'FILMES PARECIDOS',(180,685,900,740),33,True,centered=True)
    for i,movie in enumerate(metadata['related'][:3]):
        y=795+i*305
        rounded_image(related,Image.open(folder/movie['image']),(180,y,900,y+265),30)
        d.rounded_rectangle((180,y,900,y+265),30,outline='white',width=4)
        d.rounded_rectangle((190,y+188,890,y+257),15,fill=(0,0,0,210))
        text_block(d,f"{movie['title']} ({movie.get('year','')})",(210,y+205,870,y+250),27,True,centered=True)
    footer(related,contact)
    related.save(work/'phase-4.png')

def render(source,output,work,duration=30,source_crop=None):
    # The proportions 5/15/25/35s of the 42.773s reference scale with the requested duration.
    boundaries=[duration*x/42.773 for x in (5,15,25,35)]
    subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(source)],check=True,capture_output=True)
    prefix=(source_crop+',' if source_crop else '')
    graph=f'[0:v]{prefix}scale=1080:560:force_original_aspect_ratio=increase,crop=1080:560,setsar=1,fps=30,format=rgba[trailer];'
    graph+='[1:v]fps=30,format=rgba[base];'
    # Static poster opening, then moving trailer over each of the four lower panels.
    graph+=f"[base][trailer]overlay=0:0:enable='gte(t,{boundaries[0]})':shortest=1,format=yuv420p[out]"
    playlist=['ffconcat version 1.0']
    times=[0]+boundaries+[duration]
    for i in range(5):
        path=(Path(work)/f'phase-{i}.png').resolve().as_posix().replace("'","'\\''")
        playlist += [f"file '{path}'",f'duration {times[i+1]-times[i]}']
    playlist.append(f"file '{path}'")
    concat=Path(work)/'phases.ffconcat'
    concat.write_text('\n'.join(playlist)+'\n',encoding='utf-8')
    command=['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-f','concat','-safe','0','-i',str(concat)]
    command+=['-filter_complex_threads','1','-filter_complex',graph,'-map','[out]','-map','0:a?','-t',str(duration),'-r','30','-c:v','libx264','-preset','veryfast','-crf','22','-c:a','aac','-b:a','128k','-movflags','+faststart',str(output)]
    subprocess.run(command,check=True)

def load_metadata(path=None):
    if path:
        path=Path(path)
    else:
        title=' '.join(os.getenv('TITLE','').lower().split())
        year=os.getenv('RELEASE_YEAR','').strip()
        if title not in ('michael','michael jackson') or year not in ('','2026'):
            raise ValueError('movie_metadata_required')
        path=ASSETS/'michael/metadata.json'
    data=json.loads(path.read_text(encoding='utf-8'))
    data['_folder']=str(path.parent)
    # Supplied synopsis/year take precedence; never replace them with generic copy.
    for env,key in [('OVERVIEW','overview'),('RELEASE_YEAR','year')]:
        if os.getenv(env,'').strip():
            data[key]=os.environ[env].strip()
    return data

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ['source','output','work']:
        parser.add_argument('--'+key,required=True)
    parser.add_argument('--metadata'); parser.add_argument('--poster')
    parser.add_argument('--duration',type=float,default=30)
    parser.add_argument('--source-crop')
    args=parser.parse_args()
    prepare(args.work,load_metadata(args.metadata),args.poster)
    render(args.source,args.output,args.work,max(1,min(90,args.duration)),args.source_crop)
