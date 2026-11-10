import base64,json,sys,urllib.request,time,os
K=os.environ.get('GK') or open('../.env').read().split('GEMINI_API_KEY=')[1].split()[0].strip()
img=base64.b64encode(open('master.png','rb').read()).decode()
name=sys.argv[1]; prompt=sys.argv[2]
body={"model":"gemini-omni-1.2-flash","input":[
 {"type":"image","data":img,"mime_type":"image/png"},
 {"type":"image","data":img,"mime_type":"image/png"},
 {"type":"text","text":prompt}],
 "generation_config":{"video_config":{"task":"image_to_video"}},
 "response_format":{"type":"video","aspect_ratio":"9:16","resolution":"360p"}}
t=time.time()
req=urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions",json.dumps(body).encode(),{"x-goog-api-key":K,"Content-Type":"application/json"})
try: r=json.load(urllib.request.urlopen(req,timeout=170))
except urllib.error.HTTPError as e: print("HTTP",e.code,e.read()[:800].decode()); sys.exit(1)
def find(o):
  if isinstance(o,dict):
    if o.get('type')=='video' and o.get('data'): return o['data']
    for v in o.values():
      x=find(v)
      if x: return x
  if isinstance(o,list):
    for v in o:
      x=find(v)
      if x: return x
d=find(r)
if not d: print(json.dumps(r)[:1500]); sys.exit(1)
open(name,'wb').write(base64.b64decode(d)); print("ok",name,round(time.time()-t),"s")
