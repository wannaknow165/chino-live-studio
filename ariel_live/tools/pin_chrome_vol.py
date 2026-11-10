# keep the lion window's (chrome) volume at 100% — Windows/other apps keep ducking it
import time
from pycaw.pycaw import AudioUtilities, ISimpleAudioVolume
while True:
    try:
        for s in AudioUtilities.GetAllSessions():
            if s.Process and s.Process.name().lower() == 'chrome.exe':
                v = s._ctl.QueryInterface(ISimpleAudioVolume)
                if v.GetMasterVolume() < 0.99: v.SetMasterVolume(1.0, None)
                if v.GetMute(): v.SetMute(0, None)
    except Exception: pass
    time.sleep(0.25)
