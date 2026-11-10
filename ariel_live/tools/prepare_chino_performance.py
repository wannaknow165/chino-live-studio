"""Local, no-provider preparation of particles for the AI's blowing-kiss clip.

Reuses the original green-screen extraction. This is only a transparent layer;
it never invents or substitutes for the lion's missing hand animation.
"""
import argparse
import json
import math
from pathlib import Path
import cv2
import numpy as np
from prepare_kiss_effect import key_frame, encoder, write_frame, finish, place, smooth


def main():
    cv2.setNumThreads(2)
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(args.source))
    source_fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(key_frame(frame))
    cap.release()
    if not frames or source_fps <= 0:
        raise RuntimeError('No source frames')
    width, height, fps, duration = 720, 1280, 30, 5.8
    origin = np.array([width * .5, height * .39])
    rays = [(0, -155, 280), (.12, -95, 250), (.25, -35, 290),
            (.4, 25, 280), (.55, 85, 260), (.72, 145, 300)]
    out = encoder(args.output / 'chino-kiss-particles.webm', width, height, fps)
    for i in range(round(duration * fps)):
        t = i / fps
        canvas = np.zeros((height, width, 4), np.float32)
        for delay, degrees, size in rays:
            local = t - delay
            if local <= 0 or local >= len(frames) / source_fps:
                continue
            frame = frames[min(len(frames)-1, round(local * source_fps))].copy()
            frame[:, :, 3] *= smooth(0, .14, local) * smooth(0, .5, duration-t)
            theta = math.radians(degrees)
            direction = np.array([math.cos(theta), math.sin(theta)])
            travel = 65 * local + 80 * local ** 1.25
            # Anchor the lips, not the rectangular source's centre, to the paw.
            scale_size = size * (.75 + .20 * min(local, 2))
            centre = origin + direction * (travel + 156 / 592 * scale_size)
            centre[1] -= 13 * local ** 2
            place(canvas, frame, centre, scale_size, -degrees)
        alpha = canvas[:, :, 3:4]
        straight = canvas.copy()
        straight[:, :, :3] /= np.maximum(alpha, .0001)
        write_frame(out, straight)
        if i % 30 == 0:
            print(f'AI kiss particles {i}/{round(duration*fps)}', flush=True)
    finish(out)
    (args.output / 'chino-kiss-particles.json').write_text(json.dumps({
        'source': str(args.source), 'sourceUnmodified': True,
        'width': width, 'height': height, 'fps': fps, 'duration': duration,
        'alpha': True, 'audio': False, 'origin': [.5, .39],
        'owner': 'chino-ai-performance', 'gestureAttached': False,
        'releaseCueRequired': True
    }, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
