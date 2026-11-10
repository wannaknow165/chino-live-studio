"""Bounded headless browser test of CHINO's own stage; no RTSP/public broadcast."""
import argparse
import asyncio
import json
import os
import time
import urllib.request
from pathlib import Path

async def main(args):
    from playwright.async_api import async_playwright
    report = {'startedAt': int(time.time()*1000), 'headlessTest': True, 'physicalAudioVerified': False, 'framesObserved': 0, 'speakingSamples': 0}
    out = Path(args.report)
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen('http://127.0.0.1:7780/api/director/status', timeout=5) as r:
            state = json.load(r)
        if state.get('live', {}).get('active'):
            raise RuntimeError('public_live_is_active')
        if state.get('stage', {}).get('ready'):
            raise RuntimeError('another_output_owner_is_active')
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=['--autoplay-policy=no-user-gesture-required', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'])
            page = await browser.new_page(viewport={'width':720, 'height':1280})
            await page.goto('http://127.0.0.1:7780/stage', wait_until='domcontentloaded')
            await page.locator('#start').click()
            await page.wait_for_function("document.querySelector('video.on')?.readyState >= 2", timeout=30000)
            report['outputLoaded'] = True
            await page.screenshot(path=str(out.with_suffix('.png')))
            print(json.dumps({'state':'ready','headlessTest':True,'screenshot':str(out.with_suffix('.png'))}), flush=True)
            deadline = time.monotonic()+args.seconds
            while time.monotonic()<deadline and not Path(args.stop_file).exists():
                observation = await page.evaluate("""() => { const v=document.querySelector('video.on');return v?{playing:!v.paused&&!v.ended,ready:v.readyState,muted:v.muted,time:v.currentTime,width:v.videoWidth,height:v.videoHeight}:null;}""")
                if observation and observation['playing'] and observation['ready']>=2:
                    report['framesObserved'] += 1
                    if not observation['muted']:
                        report['speakingSamples'] += 1
                        if report['speakingSamples']==1:
                            await page.screenshot(path=str(out.with_name(out.stem+'-speaking.png')))
                await asyncio.sleep(.5)
            await browser.close()
    except Exception as e:
        report['error'] = str(e)[:120] if isinstance(e, RuntimeError) else type(e).__name__
    finally:
        report['finishedAt'] = int(time.time()*1000)
        out.write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps(report),flush=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--seconds',type=int,default=180)
    parser.add_argument('--report',required=True)
    parser.add_argument('--stop-file',required=True)
    args=parser.parse_args()
    args.seconds=max(10,min(args.seconds,240))
    asyncio.run(main(args))
