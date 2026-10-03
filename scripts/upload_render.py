"""Upload complete rendered media using bounded R2 multipart requests."""
import json, os, urllib.request, subprocess

base=os.environ['NEXUS_BASE_URL']+'/api/internal/video-render/upload/'
headers={'x-nexus-job-id':os.environ['JOB_ID'],'x-nexus-client-id':os.environ['CLIENT_ID'],'x-nexus-callback-token':os.environ['CALLBACK_TOKEN']}
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height:format=duration','-of','json','/tmp/rendered.mp4']))
stream=(probe.get('streams') or [{}])[0]
if int(stream.get('width') or 0) != 1080 or int(stream.get('height') or 0) != 1920:
    raise RuntimeError(f"render_not_vertical_9x16:{stream.get('width')}x{stream.get('height')}")
duration=probe['format']['duration']
def send(path,data,method='POST'):
    request=urllib.request.Request(base+path,data=data,method=method,headers={**headers,'content-type':'application/octet-stream','x-nexus-duration':duration})
    with urllib.request.urlopen(request,timeout=180) as r: return json.load(r)
send('start',b'{}')
parts=[]
with open('/tmp/rendered.mp4','rb') as source:
    while chunk:=source.read(50*1024*1024):
        parts.append(send('part?part='+str(len(parts)+1),chunk,'PUT'))
result=send('complete',json.dumps({'parts':parts}).encode())
print(json.dumps({'ok':result.get('ok'),'clipId':result.get('clipId'),'duration':duration,'parts':len(parts)}))
