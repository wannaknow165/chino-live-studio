import cv2, numpy as np, glob, json, sys, os
M=cv2.imread('media/master.png'); 
def prep(f): return cv2.cvtColor(cv2.resize(f,(180,320)),cv2.COLOR_BGR2GRAY).astype(np.float32)
def face(g): return g[60:150,45:135]   # face/crown region in 180x320
def sim(a,b):
    a=a-a.mean(); b=b-b.mean(); return float((a*b).sum()/np.sqrt((a*a).sum()*(b*b).sum()+1e-6))
m=prep(M)
rows=[]
for f in sorted(glob.glob('media/bank/*.mp4')+glob.glob('media/idle/*.mp4')):
    cap=cv2.VideoCapture(f); fr=[]
    while True:
        ok,x=cap.read()
        if not ok: break
        fr.append(prep(x))
    if not fr: continue
    jumps=[np.abs(fr[i]-fr[i-1]).mean() for i in range(1,len(fr))]
    fj=[np.abs(face(fr[i])-face(fr[i-1])).mean() for i in range(1,len(fr))]
    fs=[sim(face(g),face(m)) for g in fr[::4]]
    rows.append(dict(file=f,n=len(fr),start=round(sim(fr[0],m),3),end=round(sim(fr[-1],m),3),
        maxjump=round(float(max(jumps)),2),medjump=round(float(np.median(jumps)),2),maxfacejump=round(float(max(fj)),2),
        minface=round(float(min(fs)),3)))
json.dump(rows,open('qc/qc.json','w'),indent=1)
for r in rows: print(r)
