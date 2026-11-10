# re-encode a clip's audio to 48kHz stereo (Chrome plays 96kHz silently)
import sys, os, subprocess, tempfile, shutil
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
for src in sys.argv[1:]:
    out = tempfile.mktemp(suffix='.mp4')
    subprocess.run([FF, '-v', 'error', '-y', '-i', src, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-af', 'aeval=val(0)+0.0003*(random(0)-0.5)|val(1)+0.0003*(random(1)-0.5)', out], check=True)
    shutil.move(out, src); print('fixed', os.path.basename(src), flush=True)
