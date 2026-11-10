# A finished per-player CLIP (the boxer AND the opponent in one picture) must show WHOLE on the 9:16 stage:
# centred (not centred on the opponent's face — that pushed the dwarf boxer off the left edge) and small enough
# that nobody is cut at the sides. Run with no args = fix every clip; with ids = only those.
import sys, os, json, io
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
STAGE = 9 / 16   # the Live Studio link source is portrait 720x1280
def fit_one(names, cid):
    nm = names.get(cid)
    if not isinstance(nm, dict) or nm.get('kind') != 'clip': return None
    tp = os.path.join(ROOT, 'media', 'overlays', cid + '.json')
    if not os.path.exists(tp): return None
    tj = json.load(io.open(tp, encoding='utf-8')); w, h = float(tj.get('w') or 0), float(tj.get('h') or 0)
    if not w or not h: return None
    fit = round(STAGE * h / w * 0.96, 3); old = float(nm.get('size') or 0.56)
    nm['size'] = min(old, fit, 0.75); nm['pos'] = 'center'
    tj['mx'] = 0.5; io.open(tp, 'w', encoding='utf-8').write(json.dumps(tj))
    return (old, nm['size'])
if __name__ == '__main__':
    op = os.path.join(ROOT, 'data', 'overlays.json'); names = json.loads(io.open(op, encoding='utf-8').read())
    ids = sys.argv[1:] or [k for k, v in names.items() if isinstance(v, dict) and v.get('kind') == 'clip']
    done = {cid: fit_one(names, cid) for cid in ids}
    io.open(op, 'w', encoding='utf-8').write(json.dumps(names, ensure_ascii=False, indent=2))
    for k, v in done.items():
        if v: print(k, 'size', v[0], '->', v[1], flush=True)
