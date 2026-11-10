# Live learning handover — 2026-11-09

## Objective

Continue the existing ARIEL/CHINO project. Learn PrettyBoyAli's conversational
decisions with **the audience and opposing host**, including timing, turn taking,
humor, interruptions, follow-up, greetings, gifts and battle phases. The eventual
character is original; rendering remains undecided (generated video or a 3D rig).
Capture evidence first; do not equate model summaries with verified skills.

## Current operation

- Local control panel: `http://localhost:7777/`, Learning tab.
- Existing `data/stream.json` targets `prettyboyali24` with automatic reconnect.
- `training.observeOnly=true` blocks generated images/video and automatic speech.
  Autonomous hosting and training replies were disabled, preserving the bank.
- Gemini reported **prepayment credits depleted**. Its global billing pause is
  persisted in `data/provider_state.json`; restart does not resume paid requests.
- `training.localTranscription=true` uses a local CPU Whisper base model already
  cached on this machine. No model/API download occurs during transcription.
  The isolated `.venv-learning` does not change the other Python installations.
- Offline ASR labels speakers `UNKNOWN`. It cannot reliably distinguish the host,
  opponent or background music. All transcripts remain unverified.
- Headless capture takes precedence over browser audio/frame uploads to prevent
  unrelated desktop sound and duplicate uploads contaminating this source.

## Files and data

- `learning-store.mjs`: bounded evidence archive, provider failure classification,
  transcript normalization and transactional batch handling.
- `local-transcriber.mjs` / `tools/transcribe_local.py`: persistent bounded local
  transcription worker. Four pending jobs maximum; failed/backlogged audio remains
  in the archive. Worker failure is visible in the dashboard.
- `data/learning/observations.jsonl`: event, media, transcript and analysis records.
  Media filenames are linked by capture IDs; each row carries source/time/session.
- `data/learning/*.mp3` and `*.jpg`: retained audio and sampled frames.
- `data/local-transcription-config.json`: path to an existing cached local model.
- `backups/takeover-2026-11-09/`: pre-change source, learning data and runtime snapshots.

The archive is capped at **512 MiB** including its manifest. At the cap, saving
new evidence stops with a visible error; old evidence is never automatically
deleted. Capture timestamps are local file times, not precise broadcast timestamps.
The partial pre-restart snapshots are explicitly marked `mayBePartial`.
Previously generated legacy summaries have not been retroactively validated.
Protect runtime data and recordings; they are excluded by `.gitignore`.

## Analysis contract

New model analyses are archived as `unvalidated` candidates with an input-record
reference. Situation examples include audience/recipient, incoming utterance,
observed response/outcome, speak/wait/clarify decision and expiry condition.
Missing dialogue/outcomes must remain unknown. Event ordering is not proof of
causality. Automatic playbook compilation is suspended in observation mode.

Failed analyses retain their queue; one batch per queue runs at a time. Incoming
rows stay queued during analysis. The durable archive survives a restart; the
in-memory analysis queue does not. **Automatic historical replay is not implemented**.
Do not silently enable large backlog processing or generation when restoring billing.

## Run and verify

From this directory, use Node 24 (the existing server uses native WebSocket):

```powershell
node server.mjs
node --test learning-store.test.mjs
```

`start.bat` and `start_ariel.vbs` remain usable. Only one server may own port 7777.
For isolated port testing, `ARIEL_PORT` overrides it. A manual startup does not
install a Windows service or guarantee recovery after a PC reboot.

Recreate the local ASR environment using the installed uv and Python 3.12:

```powershell
uv venv --python 3.12 .venv-learning
uv pip install --python .venv-learning/Scripts/python.exe -r requirements-learning.lock.txt
```

`av==16.0.1` is pinned: the tested PyAV 19 release rejected the `metadata_errors`
argument used by faster-whisper 1.2.1. Runtime dependency behavior follows the
[faster-whisper upstream documentation](https://github.com/SYSTRAN/faster-whisper).

Read-only diagnostics: `/api/learning/status`, `/api/stream`, `/api/study`.
Do not print `/api/state` wholesale: the legacy route contains settings.

## Remaining work / honest limits

1. Restore an explicitly chosen analysis provider with a cost limit. Gemini is
   paused; OpenAI has not been configured or called by this change.
2. Add bounded archived-session replay, reliable speaker separation and evidence
   review. Local transcription alone does not learn a conversational policy.
3. Validate the legacy battle parser: it uses broad raw-JSON regexes, battle event
   counts are not unique completed battles, and opponent identification needs QA.
4. Build held-out replay evaluations for audience and opponent interactions,
   including response timing, avoiding interruption, stale-response cancellation,
   unknown-state handling and multi-turn coherence.
5. Decide video-bank versus rig only after the conversational decisions work.

Verified locally: unit/integration tests, offline transcription of real captured
audio, local dashboard and connected stream capture. No autonomous public broadcast,
speaker accuracy score, dialogue-quality score, billing attribution or end-to-end
response-latency guarantee has been demonstrated.

## User steering: analysis in this chat, not Gemini

The user explicitly chose review in this Codex/ChatGPT conversation; do not require
Gemini billing to resume the present work. Gemini stays disabled. The unattended
server collects evidence and runs local ASR; it does not independently invoke this
chat after a turn finishes. New reviews require an active chat/agent session.

`tools/review-snapshot.mjs` freezes a finite source packet and backfills missing
ASR locally (at most 60 audio chunks per invocation). It writes under `data/reviews`
and does not mutate the live source journal. The first review covers 476 source
records and 26 backfilled chunks; 14 sampled frames were visually inspected.
`data/chat-reviewed-behaviors.json` contains seven source-linked behavior candidates,
not validated universal conversational skills. Read it at `/api/learning/review`.

TikTools structured events now retain battle teams, host/member identities,
countdown, status, power-ups, likes, joins and viewer counts when those fields
arrive on the existing socket. This supplements the legacy truncated text log;
no extra subscription or historical-analytics entitlement was purchased.
Reference: https://tik.tools/docs . Existing historical analytics endpoints have
account/tier restrictions; their existence is not proof that this account can use them.

For the current open Blender lion and the concrete rig handover, see
[BLENDER-HANDOFF.md](BLENDER-HANDOFF.md). Rendering remains independent of the learned
conversation policy. Reuse the existing rig, 52 facial targets and local receiver.
