import json,base64,urllib.request,sys,os,concurrent.futures as cf
K=open('../.env').read().split('GEMINI_API_KEY=')[1].split()[0]
bank={e['file']:e['text'] for e in json.load(open('data/bank.json',encoding='utf-8-sig'))}
Q="""You are a strict quality inspector for a livestream. Watch this 10s video of a crowned lion king on a throne. Reference: the lion must look the same through the whole video.
Find defects: morphing/warping of face or body, double-exposure / ghosting (one video blended over another), the face or crown changing identity, distorted or asymmetric eyes, flicker, sudden jumps or cuts, extra/broken paws, text on screen.
%s
Return JSON only: {"score": 1-10 (10 = flawless, broadcast-ready), "defects": [short strings], "transcript": "exact words spoken or empty", "words_ok": true/false}"""
def review(f):
    exp=bank.get(os.path.basename(f))
    extra=('Expected spoken Hebrew text: "%s". words_ok = the speech matches it closely.'%exp) if exp else 'This is an idle clip: the lion must NOT speak; words_ok = true if silent.'
    body={"contents":[{"parts":[{"inline_data":{"mime_type":"video/mp4","data":base64.b64encode(open(f,'rb').read()).decode()}},{"text":Q%extra}]}],"generationConfig":{"responseMimeType":"application/json"}}
    r=urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",json.dumps(body).encode(),{"x-goog-api-key":K,"Content-Type":"application/json"})
    try:
        j=json.load(urllib.request.urlopen(r,timeout=170)); return f,json.loads(j['candidates'][0]['content']['parts'][0]['text'])
    except Exception as e: return f,{"error":str(e)[:200]}
files=sys.argv[1:]
with cf.ThreadPoolExecutor(6) as ex:
    for f,res in ex.map(review,files): print(os.path.basename(f), bank.get(os.path.basename(f),'IDLE'), json.dumps(res,ensure_ascii=False))
