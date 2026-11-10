"""Local WASAPI loopback -> bounded motion features. No audio recording/upload."""
import time,json,sys,collections,warnings
import numpy as np
import soundcard as sc
warnings.filterwarnings('ignore',category=sc.SoundcardRuntimeWarning)
sr=24000;n=1200;window=np.hanning(n);last=np.zeros(n//2+1);history=collections.deque(maxlen=40)
beats=collections.deque(maxlen=12);last_beat=0.;floor=.001;envelope=0.
speaker=sc.default_speaker();mic=sc.get_microphone(id=str(speaker.id),include_loopback=True)
print(json.dumps({'type':'ready','source':'system_loopback','audioSaved':False}),flush=True)
with mic.recorder(samplerate=sr,channels=2,blocksize=n) as recorder:
 while True:
  samples=recorder.record(numframes=n).mean(axis=1);now=time.monotonic()
  rms=float(np.sqrt(np.mean(samples*samples)));spec=np.abs(np.fft.rfft(samples*window))
  flux=float(np.maximum(0,spec-last)[2:40].mean());last=spec
  history.append(flux);threshold=max(.06,float(np.median(history))*1.8)
  onset=rms>.003 and flux>threshold and now-last_beat>.29 and len(history)>12
  if onset:last_beat=now;beats.append(now)
  envelope=.82*envelope+.18*min(1.,rms*10)
  bpm=None;confidence=0.
  if len(beats)>=5:
   intervals=np.diff(beats);valid=intervals[(intervals>.29)&(intervals<1.)]
   if len(valid)>=4:
    median=float(np.median(valid));confidence=max(0.,1-float(np.std(valid))/median)
    if confidence>.65:bpm=round(60/median,1)
  beat=max(0.,1-(now-last_beat)/.23) if rms>.003 else 0.
  print(json.dumps({'type':'features','at':int(time.time()*1000),'energy':round(envelope,4),'beat':round(beat,4),'bpm':bpm,'confidence':round(confidence,3),'source':'system_loopback'}),flush=True)
