# keep only the lion's voice: demucs removes music/ambience, then a gate silences everything between words
import sys, os, subprocess, tempfile, shutil
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
for src in sys.argv[1:]:
    tmp = tempfile.mkdtemp(prefix='ariel_')
    wav = os.path.join(tmp, 'a.wav')
    subprocess.run([FF, '-v', 'error', '-y', '-i', src, '-vn', '-ac', '2', '-ar', '44100', wav], check=True)
    subprocess.run([sys.executable, '-m', 'demucs', '--two-stems', 'vocals', '-n', 'htdemucs', '-o', tmp, wav], check=True, capture_output=True)
    voc = os.path.join(tmp, 'htdemucs', 'a', 'vocals.wav')
    out = os.path.join(tmp, 'out.mp4')
    # highpass: remove rumble | agate: hard-silence anything under -38dB (room tone, residue) | loudnorm: consistent level
    af = 'highpass=f=90,agate=threshold=0.0125:ratio=9:attack=4:release=140:knee=2,afftdn=nf=-32:nt=w,loudnorm=I=-16:TP=-1.5:LRA=7,aeval=val(0)+0.0003*(random(0)-0.5)|val(1)+0.0003*(random(1)-0.5)'
    subprocess.run([FF, '-v', 'error', '-y', '-i', src, '-i', voc, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-af', af, '-shortest', out], check=True)
    shutil.copyfile(out, src); shutil.rmtree(tmp, ignore_errors=True)
    print('clean', os.path.basename(src), flush=True)
