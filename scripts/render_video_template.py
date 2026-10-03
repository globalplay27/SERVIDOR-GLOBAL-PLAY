"""Five-part customer template; movie artwork and all copy stay data-driven."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import urllib.request
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

def text_block(draw, text, box, size=30, bold=False, fill='white', centered=False, excerpt=False):
    x,y,right,bottom = box
    while size >= 16:
        face = font(size,bold)
        wrapped = lines(draw,text,face,right-x)
        spacing = round(size*1.3)
        if len(wrapped)*spacing <= bottom-y:
            break
        size -= 1
    if len(wrapped)*spacing > bottom-y:
        if not excerpt: raise ValueError('text_does_not_fit')
        wrapped=wrapped[:max(1,int((bottom-y)/spacing))]
        wrapped[-1]=wrapped[-1].rsplit(' ',1)[0]+'…'
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

def contact_icon(canvas, contact='', y=1775, size=56):
    # Unmodified glyph from Meta's official WhatsApp Brand Resource Center, 2026.
    icon=Image.open(ASSETS/'whatsapp-official.png').convert('RGBA')
    icon.thumbnail((size,size),Image.Resampling.LANCZOS)
    d=ImageDraw.Draw(canvas); face=font(34 if size==56 else 28,True)
    label=contact or 'WhatsApp'
    width=d.textlength(label,font=face)
    x=int((W-size-20-width)/2)
    canvas.alpha_composite(icon,(x,y))
    d.text((x+size+20,y+(size-face.size)/2),label,font=face,fill='white')


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
    text_block(d,os.getenv('END_TEXT') or 'DISPONÍVEL EM NOSSO APLICATIVO',(100,1740,980,1772),24,centered=True)
    labels=['TV SMART','TV BOX','PC/NOTE','CELULAR','XBOX','CAST']
    for i,label in enumerate(labels):
        x=200+i*130
        if i in (0,1,2):
            d.rounded_rectangle((x-32,1840,x+32,1878),4,outline='white',width=3)
            d.line((x-10,1879,x+10,1879),fill='white',width=3)
        elif i==3:
            d.rounded_rectangle((x-16,1834,x+16,1880),4,outline='white',width=3)
            d.line((x-6,1875,x+6,1875),fill='white',width=2)
        elif i==4:
            d.ellipse((x-24,1834,x+24,1882),outline='white',width=3)
            d.line((x-17,1840,x+17,1876),fill='white',width=3)
            d.line((x+17,1840,x-17,1876),fill='white',width=3)
        else:
            d.rounded_rectangle((x-28,1840,x+28,1880),4,outline='white',width=3)
            for radius in (9,16,23):
                d.arc((x-31-radius,1866-radius,x-31+radius,1866+radius),270,360,fill='white',width=3)
        text_block(d,label,(x-60,1887,x+60,1912),16,centered=True)
    contact_icon(canvas,contact)


def prepare(work, metadata, poster_path=None):
    work=Path(work); work.mkdir(parents=True,exist_ok=True)
    folder=Path(metadata['_folder'])
    poster=Image.open(poster_path or folder/metadata['poster']).convert('RGB')
    required=['title','overview']
    if any(not metadata.get(field) for field in required):
        raise ValueError('movie_metadata_incomplete')
    # Keep the synopsis visually close to the supplied reference: short, readable and never a large card.
    overview=' '.join(str(metadata.get('overview') or '').split())
    if len(overview)>125:
        overview=overview[:122].rsplit(' ',1)[0]+'…'
    metadata=dict(metadata,overview=overview)
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
    text_block(d,metadata['overview'],(145,1560,935,1688),24,centered=True,excerpt=True)
    footer(intro,contact)
    intro.save(work/'phase-0.png')

    launch=bg.copy(); d=ImageDraw.Draw(launch)
    text_block(d,metadata.get('media_type','FILME'),(100,586,510,635),31,centered=True)
    for j,word in enumerate(['LAN','ÇA','MEN','TO']):
        text_block(d,word,(100,650+j*130,550,790+j*130),110,True,centered=True)
    glow=Image.new('RGBA',(W,H)); ImageDraw.Draw(glow).rounded_rectangle((612,592,1028,1268),40,outline='white',width=15)
    launch.alpha_composite(glow.filter(ImageFilter.GaussianBlur(14)))
    rounded_image(launch,poster,(620,600,1020,1260),35)
    d.rounded_rectangle((620,600,1020,1260),35,outline='white',width=4)
    text_block(d,metadata['title'],(100,1320,580,1420),31,True)
    text_block(d,' • '.join(filter(None,[metadata.get('year'),metadata.get('genres'),metadata.get('runtime'),metadata.get('rating')])),(100,1425,580,1495),20)
    text_block(d,metadata['overview'],(100,1500,550,1700),24,excerpt=True)
    popcorn=Image.open(ASSETS/'popcorn.webp').convert('RGBA')
    popcorn.thumbnail((640,740),Image.Resampling.LANCZOS)
    launch.alpha_composite(popcorn,(550,1195))
    footer(launch,contact)
    launch.save(work/'phase-1.png')

    cast=bg.copy(); d=ImageDraw.Draw(cast)
    if not metadata.get('cast'):
        text_block(d,'ELENCO',(180,730,900,830),55,True,centered=True)
        text_block(d,'Informações de elenco ainda não disponíveis na fonte.',(180,1000,900,1250),34,centered=True)
    for i,person in enumerate(metadata['cast'][:9]):
        cx=195+(i%3)*345; cy=750+(i//3)*425
        image=ImageOps.fit(Image.open(folder/person['image']).convert('RGB'),(250,250),centering=(.5,.25)) if person.get('image') else Image.new('RGB',(250,250),'#243447')
        mask=Image.new('L',(250,250)); ImageDraw.Draw(mask).ellipse((0,0,249,249),fill=255)
        glow=Image.new('RGBA',(W,H)); ImageDraw.Draw(glow).ellipse((cx-141,cy-141,cx+141,cy+141),fill='white')
        cast.alpha_composite(glow.filter(ImageFilter.GaussianBlur(9)))
        d.ellipse((cx-140,cy-140,cx+140,cy+140),fill='white')
        cast.paste(image,(cx-125,cy-125),mask)
        text_block(d,person['name'],(cx-150,cy+153,cx+150,cy+257),36,True,centered=True)
    contact_icon(cast,contact,y=1860,size=48)
    cast.save(work/'phase-2.png')

    reviews=bg.copy(); d=ImageDraw.Draw(reviews)
    if not metadata.get('reviews'):
        text_block(d,'AVALIAÇÕES',(180,730,900,830),55,True,centered=True)
        text_block(d,'Ainda não há avaliações verificadas para este título.',(180,1000,900,1250),34,centered=True)
    for i,review in enumerate(metadata['reviews'][:3]):
        y=660+i*340
        points=[]
        for j in range(32):
            x=100+j*28
            points.append((x,y+(12 if j%2 else -7)))
        points += [(970-j*28,y+280+(10 if j%2 else -7)) for j in range(32)]
        d.polygon(points,fill='#e0c7ff')
        text_block(d,review['author'],(240,y+27,900,y+70),27,True,fill='#17202c')
        text_block(d,review.get('source',''),(240,y+67,900,y+100),18,fill='#333545')
        text_block(d,review['text'],(145,y+119,925,y+230),28,fill='#17202c')
        text_block(d,'Síntese em português' if review.get('summary',True) else 'Nota da fonte',(145,y+244,925,y+275),17,fill='#51425b')
    footer(reviews,contact)
    reviews.save(work/'phase-3.png')

    related=bg.copy(); d=ImageDraw.Draw(related)
    text_block(d,'SÉRIES PARECIDAS' if metadata.get('media_type') == 'SÉRIE' else 'FILMES PARECIDOS',(180,685,900,740),33,True,centered=True)
    if not metadata.get('related'):
        text_block(d,'Sugestões ainda não disponíveis.',(180,1000,900,1250),34,centered=True)
    for i,movie in enumerate(metadata['related'][:3]):
        y=795+i*305
        rounded_image(related,Image.open(folder/movie['image']),(180,y,900,y+265),30)
        d.rounded_rectangle((180,y,900,y+265),30,outline='white',width=4)
        d.rounded_rectangle((190,y+188,890,y+257),15,fill=(0,0,0,210))
        text_block(d,f"{movie['title']} ({movie.get('year','')})",(210,y+205,870,y+250),27,True,centered=True)
    footer(related,contact)
    related.save(work/'phase-4.png')
    for i in range(5):
        if metadata.get('sources'):
            path=work/f'phase-{i}.png'; panel=Image.open(path).convert('RGBA')
            source='TVmaze • CC BY-SA' if any('tvmaze' in x for x in metadata['sources']) else 'Fonte: Apple / iTunes'
            ImageDraw.Draw(panel).text((15,1900),source,font=font(12),fill='#adbdc7')
            panel.save(path)

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

def render_plain(source,output,duration,source_crop=None):
    """Direct file uploads: convert to 9:16 without inventing title, synopsis or poster."""
    prefix=(source_crop+',' if source_crop else '')
    graph=f'[0:v]{prefix}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[out]'
    command=['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),
             '-filter_complex',graph,'-map','[out]','-map','0:a?','-t',str(duration),'-r','30',
             '-c:v','libx264','-preset','veryfast','-crf','22','-c:a','aac','-b:a','128k',
             '-movflags','+faststart',str(output)]
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

def materialize_metadata(data, work, private_poster=None):
    folder=Path(work)/'assets'; folder.mkdir(parents=True,exist_ok=True)
    def download(url,name,required=False):
        if not url:
            if required: raise ValueError('official_poster_required')
            return ''
        # Only known public catalogue image hosts; never arbitrary internal URLs.
        from urllib.parse import urlparse
        host=urlparse(url).hostname or ''
        allowed=('tvmaze.com','mzstatic.com','tmdb.org')
        if urlparse(url).scheme != 'https' or not any(host==h or host.endswith('.'+h) for h in allowed):
            if required: raise ValueError('poster_host_not_allowed')
            return ''
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'NEXUS-video-template'}),timeout=30) as r:
                raw=r.read(10*1024*1024+1)
            if len(raw)>10*1024*1024: raise ValueError('image_too_large')
            p=folder/name; p.write_bytes(raw)
            with Image.open(p) as img: img.verify()
            return name
        except Exception:
            if required: raise
            return ''
    data['poster']=str(Path(private_poster).resolve()) if private_poster else download(data.get('posterUrl'),'poster.jpg',False)
    data['media_type']=data.get('mediaType','FILME')
    data['_folder']=str(folder)
    for i,person in enumerate(data.get('cast',[])[:9]): person['image']=download(person.get('image'),f'cast-{i}.jpg')
    data['related']=[dict(x,image=download(x.get('image'),f'related-{i}.jpg')) for i,x in enumerate(data.get('related',[])[:3])]
    data['related']=[x for x in data['related'] if x['image']]
    data.setdefault('cast',[]); data.setdefault('reviews',[]); data.setdefault('related',[])
    data['overview']=os.getenv('OVERVIEW') or data.get('overview','')
    return data

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ['source','output','work']:
        parser.add_argument('--'+key,required=True)
    parser.add_argument('--metadata'); parser.add_argument('--poster')
    parser.add_argument('--duration',type=float,default=0)
    parser.add_argument('--source-crop')
    args=parser.parse_args()
    supplied=os.getenv('MOVIE_METADATA','').strip()
    title=' '.join(os.getenv('TITLE','').lower().split())
    if args.metadata or title in ('michael','michael jackson'):
        metadata=load_metadata(args.metadata)
    else:
        try:
            data=json.loads(supplied) if supplied else {}
        except json.JSONDecodeError:
            data={}
        if not isinstance(data,dict):
            data={}
        private_poster='/tmp/poster.jpg' if str(data.get('posterUrl','')).startswith(os.environ.get('NEXUS_BASE_URL','https://invalid.example')+'/media/') and Path('/tmp/poster.jpg').exists() else None
        metadata=materialize_metadata(data,args.work,private_poster)
    source_duration=float(json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',args.source]))['format']['duration'])
    duration=min(source_duration,args.duration) if args.duration>0 else source_duration
    has_editorial_metadata=bool(str(metadata.get('overview') or '').strip() and str(metadata.get('poster') or '').strip())
    if has_editorial_metadata:
        prepare(args.work,metadata,args.poster)
        render(args.source,args.output,args.work,max(.1,duration),args.source_crop)
    else:
        render_plain(args.source,args.output,max(.1,duration),args.source_crop)
