# set Spotify's volume (0..1) without touching the system volume
import sys
from pycaw.pycaw import AudioUtilities, ISimpleAudioVolume
lvl = float(sys.argv[1])
for s in AudioUtilities.GetAllSessions():
    if s.Process and s.Process.name().lower() == 'spotify.exe':
        s._ctl.QueryInterface(ISimpleAudioVolume).SetMasterVolume(lvl, None)
print('ok')
