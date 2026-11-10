# Identify the song playing in a short audio clip (Shazam, free, no key). Usage: py -3.13 shazam.py clip.mp3
# Prints one JSON line: {"ok":true,"title":..,"artist":..,"spotify":"spotify:track:..."|"", "key":..} or {"ok":false}
import sys, json, asyncio, shutil, os, tempfile

async def main(path):
    from shazamio import Shazam
    # shazamio needs an ASCII path on Windows for its decoder — copy to temp
    tmp = os.path.join(tempfile.gettempdir(), 'shz_probe' + os.path.splitext(path)[1])
    shutil.copyfile(path, tmp)
    try:
        out = await Shazam().recognize(tmp)
    finally:
        try: os.remove(tmp)
        except Exception: pass
    tr = (out or {}).get('track') or {}
    if not tr.get('title'):
        print(json.dumps({'ok': False})); return
    sp = ''
    for p in (tr.get('hub') or {}).get('providers', []) or []:
        if p.get('type') == 'SPOTIFY':
            for a in p.get('actions', []) or []:
                u = a.get('uri') or ''
                if u.startswith('spotify:'):
                    sp = u if u.startswith('spotify:track:') else ''
    genre = ((tr.get('genres') or {}).get('primary')) or ''
    print(json.dumps({'ok': True, 'title': tr.get('title'), 'artist': tr.get('subtitle'), 'spotify': sp, 'genre': genre, 'key': tr.get('key')}, ensure_ascii=False))

if __name__ == '__main__':
    try:
        asyncio.run(main(sys.argv[1]))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
