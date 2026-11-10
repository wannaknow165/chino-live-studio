# record the computer's sound (loopback) until a stop-file appears or max seconds pass
import sys, os, time, wave, numpy as np, soundcard as sc
out, stopfile, maxsec = sys.argv[1], sys.argv[2], float(sys.argv[3])
SR = 16000
spk = sc.default_speaker()
mic = sc.get_microphone(id=str(spk.name), include_loopback=True)
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
t0 = time.time()
with mic.recorder(samplerate=SR, channels=1) as r:
    while time.time() - t0 < maxsec and not os.path.exists(stopfile):
        d = r.record(numframes=SR // 2)
        w.writeframes((np.clip(d[:, 0], -1, 1) * 32767).astype('<i2').tobytes())
w.close(); print('done', round(time.time() - t0, 1))
