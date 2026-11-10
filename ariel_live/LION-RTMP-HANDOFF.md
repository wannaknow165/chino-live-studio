# Lion RTMP handoff — 2026-11-10

Published path: `boostera/client001/lion`

Endpoint on the MediaMTX host:

```text
rtmp://127.0.0.1:1935/boostera/client001/lion
```

The source is the existing CHINO stage at `http://127.0.0.1:7780/stage`, including real rendered video and media-element audio. It is not a fixed video file. Headless Chromium produces JPEG frames; FFmpeg encodes H.264 video at 720x1280, 30fps, and AAC stereo audio at 48000 Hz / 128k.

## Runtime

- Publisher service: `chino-lion-rtmp.service`, enabled on boot, restarted on failure.
- Source script: `tools/chino_to_rtmp.py`.
- Status: `data/video-director/lion-rtmp-status.json`.
- Encoder log: `data/video-director/lion-rtmp-ffmpeg.log`.
- The publisher respects the existing output-owner lease and does not take an active stage from another owner.
- Stage ownership makes CHINO playback available; public TikTok delivery, chat input and opponent-audio capture are separate connections.

## MediaMTX configuration

Added exactly `boostera/client001/lion` with source publisher and `overridePublisher: false`. Local-loopback publish/read permissions were added only for this path. Existing network listener addresses were preserved. The requested address is host-local; downstream VLAN routing remains with the consuming operator.

During the first configuration update, replacement-file ownership prevented MediaMTX from reading it and interrupted the existing streams. The exact original configuration was restored, service ownership repaired, and the service recovered. The final update preserved ownership. The existing camera publisher was resumed through its original controller with its saved settings. Final verification confirmed `camera`, `feed`, `live` and `lion` ready together.

## Readback evidence

A fresh RTMP reader recorded 12.0105 seconds while CHINO played its existing spoken introduction. FFprobe on the resulting readback found:

- H.264, 720x1280, 30/1 fps.
- AAC, 48000 Hz, 2 channels.
- Decoded audio mean -28.6 dB and peak -9.6 dB (actual speech, not only a silent audio track).

Local evidence is runtime data excluded from Git: `data/video-director/lion-rtmp-proof-20261110.mp4` and `lion-rtmp-proof.json`. MediaMTX API reports `ready:true`, H264 and MPEG-4 Audio tracks with increasing received-byte counters. This does not prove delivery through a downstream VLAN consumer or public TikTok.
