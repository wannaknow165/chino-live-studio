"""Prepare the supplied green-screen kiss clip as reusable, silent alpha assets.

The source is never modified. Requires the project's existing OpenCV/numpy and
ffmpeg. The portrait burst uses the same cleaned footage, with staggered copies.
"""
import argparse
import json
import math
from pathlib import Path
import subprocess

import cv2
import numpy as np


def smooth(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def key_frame(bgr):
    # The bottom of this recording contains the physical screen edge. The lips
    # remain entirely above it. Feather the particle exits instead of hard cuts.
    rgb = cv2.cvtColor(bgr[:330], cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    r, g, b = rgb.transpose(2, 0, 1)
    rb = np.maximum(r, b)
    a = smooth(.22, .96, rb / np.maximum(g, .015)) * smooth(.025, .13, rb)
    matte = a.copy()
    h, w = a.shape
    yy, xx = np.indices((h, w), dtype=np.float32)
    a *= smooth(0, 18, yy) * smooth(0, 6, h - 1 - yy)
    a *= smooth(0, 8, xx) * smooth(0, 105, w - 1 - xx)
    # Feather the recorded plume into an organic shape, not a rectangular card.
    # Keep the entire left-side lip silhouette (including its lower edge).
    plume = smooth(235, 325, xx)
    vertical = 1-smooth(.35, 1, np.abs(yy-165)/165)
    a *= (1-plume)+plume*vertical
    # This asset contains red/pink/white foreground, so excess green is spill.
    # Unpremultiply red/blue edge pixels before encoding straight-alpha WebM.
    rgb[:, :, 1] = np.minimum(g, np.minimum(r, b))
    rgb /= np.maximum(matte[:, :, None], .07)
    rgb = np.clip(rgb, 0, 1)
    rgb[a < .003] = 0
    return np.dstack((rgb, a))


def encoder(path, width, height, fps, alpha=True):
    args = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f',
            'rawvideo', '-pix_fmt', 'rgba', '-s', f'{width}x{height}',
            '-r', str(fps), '-i', '-', '-an']
    if alpha:
        args += ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref',
                 '0', '-crf', '25', '-b:v', '0', '-row-mt', '1',
                 '-cpu-used', '4', '-threads', '4']
    else:
        args += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21',
                 '-preset', 'veryfast', '-movflags', '+faststart']
    return subprocess.Popen(args + [str(path)], stdin=subprocess.PIPE)


def write_frame(process, frame):
    process.stdin.write(np.uint8(np.clip(frame, 0, 1) * 255).tobytes())


def finish(process):
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError('ffmpeg encoding failed')


def place(canvas, frame, center, width, angle):
    h, w = frame.shape[:2]
    # Transform premultiplied pixels so transparent borders cannot create halos.
    premul = frame.copy()
    premul[:, :, :3] *= premul[:, :, 3:4]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, width / w)
    matrix[:, 2] += np.array(center) - np.array([w / 2, h / 2])
    warped = cv2.warpAffine(premul, matrix, (canvas.shape[1], canvas.shape[0]),
                            flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    canvas[:] = warped + canvas * (1 - warped[:, :, 3:4])


def main():
    cv2.setNumThreads(2)
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--background', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(args.source))
    fps_src = capture.get(cv2.CAP_PROP_FPS)
    frames = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(key_frame(frame))
    capture.release()
    if not frames or not fps_src:
        raise RuntimeError('No decodable source frames')
    duration = len(frames) / fps_src
    fps, width, height = 30, 720, 1280
    clean = encoder(args.output / 'kiss-clean-alpha.webm', 592, 330, fps)
    for i in range(math.ceil(duration * fps)):
        t = i / fps
        f = frames[min(len(frames)-1, round(t * fps_src))].copy()
        f[:, :, 3] *= smooth(0, .08, t) * smooth(0, .25, duration-t)
        write_frame(clean, f)
    finish(clean)
    print('Clean alpha encoded', flush=True)
    burst_path = args.output / 'kiss-burst-alpha.webm'
    burst = encoder(burst_path, width, height, fps)
    preview = encoder(args.output / 'kiss-burst-preview.mp4', width, height, fps, False)
    bg = cv2.imread(str(args.background)) if args.background else None
    if bg is not None:
        bg = cv2.cvtColor(cv2.resize(bg, (width, height)), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    else:
        y, x = np.indices((height, width))
        bg = np.repeat(np.where(((x//32+y//32)%2)[..., None], .13, .21), 3, axis=2)
    # Main kiss plus five lighter, staggered bursts spreading across the canvas.
    # Each tuple: delay, horizontal origin, vertical origin, width, rotation.
    shots = [(0, .57, .48, 860, 0), (.35, .25, .28, 380, -25),
             (.52, .76, .69, 400, 22), (.72, .78, .16, 340, 30),
             (.95, .25, .84, 400, -28), (1.10, .55, .58, 450, 12)]
    total = duration + 1.10
    sample_times = [0.7, 1.5, 2.5, 3.5]
    for i in range(math.ceil(total * fps)):
        t = i / fps
        canvas = np.zeros((height, width, 4), np.float32)
        for delay, x, y, size, angle in shots:
            local = t-delay
            if local < 0 or local >= duration:
                continue
            f = frames[min(len(frames)-1, round(local * fps_src))].copy()
            f[:, :, 3] *= smooth(0, .1, local) * smooth(0, .35, duration-local)
            if delay:
                f[:, :, 3] *= .84
            progress = local / duration
            center = (width*(x+(x-.5)*progress*.23), height*(y+(y-.5)*progress*.14))
            place(canvas, f, center, size*(.90+.14*progress), angle)
        a = canvas[:, :, 3:4]
        straight = canvas.copy()
        straight[:, :, :3] /= np.maximum(a, .0001)
        write_frame(burst, straight)
        composed = np.dstack((canvas[:, :, :3]+bg*(1-a), np.ones((height,width))))
        write_frame(preview, composed)
        if any(abs(t-st) < .5/fps for st in sample_times):
            cv2.imwrite(str(args.output / f'preview-{t:.1f}.png'),
                        cv2.cvtColor(np.uint8(composed[:,:,:3]*255), cv2.COLOR_RGB2BGR))
        if i % 30 == 0:
            print(f'Portrait burst {i}/{math.ceil(total*fps)}', flush=True)
    finish(burst)
    finish(preview)
    manifest = {'source': str(args.source), 'sourceUnmodified': True,
                'width': width, 'height': height, 'fps': fps,
                'duration': round(math.ceil(total*fps)/fps,3),
                'alpha': True, 'audio': False, 'gestureAttached': False,
                'burstDelayMs': 0, 'files': ['kiss-clean-alpha.webm',
                'kiss-burst-alpha.webm', 'kiss-burst-preview.mp4']}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest), flush=True)


if __name__ == '__main__':
    main()
