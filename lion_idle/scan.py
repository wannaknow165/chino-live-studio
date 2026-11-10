import cv2, numpy as np, glob, sys
v=glob.glob('public/assets/aistudio/*.mp4')[0]
cap=cv2.VideoCapture(v); fr=[]
while True:
    ok,f=cap.read()
    if not ok: break
    fr.append(cv2.resize(cv2.cvtColor(f,cv2.COLOR_BGR2GRAY),(120,212)).astype(np.float32))
n=len(fr); print('frames',n)
ref=fr[0]
for i in range(0,n,12):
    d0=np.abs(fr[i]-ref).mean()
    mot=np.abs(fr[i]-fr[max(i-1,0)]).mean()
    print(f"{i/24:5.1f}s diff_to_start={d0:5.1f} motion={mot:4.2f}")
