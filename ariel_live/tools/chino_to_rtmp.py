"""Publish the existing CHINO stage, including its real media audio, to local MediaMTX."""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import tempfile
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
TARGET = 'rtmp://127.0.0.1:1935/boostera/client001/lion'


async def main(args):
    from playwright.async_api import async_playwright
    status_path = Path(args.status)
    status_path.parent.mkdir(parents=True, exist_ok=True)
    state = {'pid': os.getpid(), 'state': 'starting', 'width': 720, 'height': 1280,
             'fps': 30, 'frames': 0, 'captured': 0, 'audioBytes': 0,
             'audioPeak': 0, 'target': TARGET, 'startedAt': time.time()}

    def save(**values):
        state.update(values, updatedAt=time.time())
        temp = status_path.with_suffix('.tmp')
        temp.write_text(json.dumps(state), encoding='utf-8')
        temp.replace(status_path)

    with urllib.request.urlopen('http://127.0.0.1:7780/api/director/status', timeout=5) as r:
        current = json.load(r)
    if current.get('stage', {}).get('ready'):
        save(state='waiting_for_output_owner')
        raise RuntimeError('another_output_owner_is_active')

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    audio = queue.Queue(maxsize=256)
    latest = {'frame': None, 'at': time.monotonic()}
    process = None
    thread_stop = threading.Event()
    failure = []

    with tempfile.TemporaryDirectory(prefix='chino-lion-rtmp-') as runtime:
        fifo = Path(runtime) / 'audio.pcm'
        os.mkfifo(fifo, 0o600)
        log = open(ROOT / 'data/video-director/lion-rtmp-ffmpeg.log', 'ab', buffering=0)
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, args=[
                    '--autoplay-policy=no-user-gesture-required', '--no-sandbox',
                    '--disable-dev-shm-usage', '--disable-gpu',
                    '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
                context = await browser.new_context(viewport={'width': 720, 'height': 1280}, device_scale_factor=1)
                page = await context.new_page()

                async def receive_audio(source, packet):
                    if thread_stop.is_set():
                        return
                    try:
                        audio.put_nowait(base64.b64decode(packet['b64'], validate=True))
                        state['audioPeak'] = max(state['audioPeak'], float(packet['peak']))
                    except queue.Full:
                        failure.append('audio_backpressure')
                        stop.set()

                await page.expose_binding('chinoPCM', receive_audio)
                await page.goto('http://127.0.0.1:7780/stage', wait_until='domcontentloaded')
                await page.evaluate("""async () => {
                    const ctx = new AudioContext({sampleRate:48000});
                    const mix = ctx.createGain();
                    const nodes = [...document.querySelectorAll('video')].map(v => {
                        const source=ctx.createMediaElementSource(v),gain=ctx.createGain();
                        source.connect(gain);gain.connect(mix);return {v,gain};
                    });
                    const processor=ctx.createScriptProcessor(2048,2,2);
                    mix.connect(processor);processor.connect(ctx.destination);
                    processor.onaudioprocess=e=>{
                        for(const {v,gain} of nodes)gain.gain.value=v.muted?0:1;
                        const a=e.inputBuffer.getChannelData(0),b=e.inputBuffer.getChannelData(1);
                        const pcm=new Int16Array(a.length*2);let peak=0;
                        for(let i=0;i<a.length;i++){
                            peak=Math.max(peak,Math.abs(a[i]),Math.abs(b[i]));
                            pcm[i*2]=Math.max(-1,Math.min(1,a[i]))*32767;
                            pcm[i*2+1]=Math.max(-1,Math.min(1,b[i]))*32767;
                        }
                        window.chinoPCM({b64:btoa(String.fromCharCode(...new Uint8Array(pcm.buffer))),peak}).catch(()=>{});
                    };
                    window.chinoAudioTap={ctx,mix,processor,nodes};await ctx.resume();
                }""")
                await page.locator('#start').click()
                await page.wait_for_function("document.querySelector('video.on')?.readyState >= 2", timeout=30000)
                cdp = await context.new_cdp_session(page)

                def frame(event):
                    latest['frame'] = base64.b64decode(event['data'])
                    latest['at'] = time.monotonic()
                    state['captured'] += 1
                    asyncio.create_task(cdp.send('Page.screencastFrameAck', {'sessionId': event['sessionId']}))

                cdp.on('Page.screencastFrame', frame)
                await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 85,
                    'maxWidth': 720, 'maxHeight': 1280, 'everyNthFrame': 1})
                command = ['ffmpeg', '-hide_banner', '-loglevel', 'warning', '-nostdin',
                    '-thread_queue_size', '256', '-analyzeduration', '100000', '-probesize', '100000',
                    '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', 'pipe:0',
                    '-thread_queue_size', '256', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', str(fifo),
                    '-map', '0:v:0', '-map', '1:a:0', '-vf', 'scale=720:1280,format=yuv420p',
                    '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
                    '-g', '60', '-bf', '0', '-b:v', '3500k', '-maxrate', '4000k', '-bufsize', '4000k',
                    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
                    '-f', 'flv', '-flvflags', 'no_duration_filesize', TARGET]
                process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=log, stdout=subprocess.DEVNULL)

                def video_writer():
                    tick = time.monotonic()
                    try:
                        while not thread_stop.is_set():
                            if latest['frame'] is None:
                                time.sleep(.01)
                                tick = time.monotonic()
                                continue
                            if time.monotonic()-latest['at'] > 8:
                                raise RuntimeError('stage_frames_stalled')
                            process.stdin.write(latest['frame'])
                            state['frames'] += 1
                            tick += 1/30
                            time.sleep(max(0, tick-time.monotonic()))
                            if time.monotonic()-tick > 1:
                                tick = time.monotonic()
                    except (OSError, RuntimeError) as e:
                        failure.append(str(e) if isinstance(e, RuntimeError) else 'video_pipe_closed')

                def audio_writer():
                    try:
                        with fifo.open('wb', buffering=0) as output:
                            while not thread_stop.is_set():
                                try:
                                    chunk = audio.get(timeout=.5)
                                except queue.Empty:
                                    continue
                                output.write(chunk)
                                state['audioBytes'] += len(chunk)
                    except OSError:
                        if not thread_stop.is_set():
                            failure.append('audio_pipe_closed')

                threading.Thread(target=video_writer, daemon=True).start()
                threading.Thread(target=audio_writer, daemon=True).start()
                while not stop.is_set():
                    if process.poll() is not None:
                        raise RuntimeError('rtmp_encoder_exited')
                    if failure:
                        raise RuntimeError(failure[0])
                    save(state='streaming' if state['frames'] >= 30 and state['audioBytes'] >= 192000 else 'starting')
                    await asyncio.sleep(1)
                await cdp.send('Page.stopScreencast')
                await browser.close()
        except Exception as e:
            save(state='error', error=str(e) if isinstance(e, RuntimeError) else type(e).__name__)
            raise
        finally:
            thread_stop.set()
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
            log.close()
            if state['state'] != 'error':
                save(state='stopped')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--status', default=str(ROOT / 'data/video-director/lion-rtmp-status.json'))
    asyncio.run(main(parser.parse_args()))
