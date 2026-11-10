# send a media key to Windows (controls Spotify desktop)
import sys, ctypes
VK = {'play': 0xB3, 'next': 0xB0, 'prev': 0xB1}[sys.argv[1]]
u = ctypes.windll.user32
u.keybd_event(VK, 0, 0, 0); u.keybd_event(VK, 0, 2, 0)
print('ok')
