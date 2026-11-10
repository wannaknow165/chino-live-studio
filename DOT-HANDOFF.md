# CHINO: verified handoff and acceptance for Dot

Continue the existing private `wannaknow165/chino-live-studio` repository. Do not rebuild it. Read `CURRENT-HANDOFF.md`, `README-MAC.md`, `ariel_live/docs/LEARNING-LIBRARY.md` and `ariel_live/docs/LEARNING-PLAN.md` before changing behavior. This document is project context, not proof that a Dot has received or executed it.

## Ownership and objective

The owner asked Dot to take ongoing responsibility for developing and evaluating an original Hebrew/English TikTok LIVE battle host. The local Codex operator remains responsible until an actual receiving task is identified and its access and progress are verified. Do not invent a handoff acknowledgement or claim that running a background job proves hosting ability.

Reuse existing architecture, assets, response index, voice/video engines and budget accounting. Keep teacher observation separate from the owner's audience/opponent input. Let other speakers finish; sustained engagement means relevant hosting, not uninterrupted noise or repeated unanswered questions.

## Components and local paths

- Project: `C:\Users\shk\Downloads\the-voice-—-hebrew-narrator-studio\ariel_live`.
- Director: `node auto-host-server.mjs`, port 7780; original voice/clip bank, semantic response selection and operator controls.
- Teacher capture/effects: `node server.mjs`, port 7777. Training remains observation-only; it must not generate paid response clips merely because a teacher speaks.
- Library: `node learning-worker.mjs`, loopback port 7781; dashboard, persistent import queue and source-linked candidates.
- Local library and original study files: `C:\Users\shk\CHINO-Learning`; inbox `Inbox`, state `library.json`, archive import provenance `Imports`.
- Live evidence: `ariel_live/data/learning/observations.jsonl` and its bounded media archive.

The local library, private runtime, credentials, Python environment/model cache and new source exports are NOT automatically available through Git. Copy or connect them deliberately after confirming target identity. Never start two workers against one state directory or reset ledgers to make a blocked queue appear healthy.

## Source corpus and known state (snapshot 2026-11-10)

The owner's two NotebookLM exports were copied into `Inbox/NotebookLM-2026-11-10`: 63 files, 59 unique content hashes, four duplicates. Original ZIPs remain in Downloads. The additional owner-goals file means the library inventory contains 64 files in total. PPTX slides are images: use the visual extraction path, not empty XML text. Videos currently use audio transcription; this does not verify visual performance.

At the last inspection the library had 110 analyzed parts, 487 waiting parts, 44 candidate lessons, one applied guidance bundle and zero independently verified behavioral successes. AI queue status was `daily_request_limit`: the worker's 48-request rolling 24-hour guard was reached. This is a deliberate guard, not evidence of a provider outage or completed study. Preserve approved spending ceilings; any scheduling or batching change must not bypass the persistent provider and live-production ledgers.

The source analyzer is `POST /api/director/learning/analyze`, not the old live-observation route that clipped rows to 500 characters. Full-source v2 retains original evidence hashes, validates text quotations and labels image observations separately. Previous partial file analyses remain audit records and cannot be applied as fully studied lessons.

One operator guidance bundle derived from the supplied quiz was applied. It includes selective semantic memory retrieval and checking that a tool/action really exists before claiming execution. Application is not a passed behavioral test or model-weight training.

The existing 100-case response-selection evaluation scored 99/100. It does not play media or verify microphone/latency/lip sync. The failed case asked the character to use another name; it played its original identity response instead of the draft/ignore actions expected by that fixture. Do not rewrite test expectations merely to report 100%.

## Current blockers and operating constraints

The local service health checks had failed and later recovered during parallel work. A fresh real OpenAI source-analysis request succeeded after restoring the credential through the existing memory-only endpoint. Do not infer listener ownership from a newly launched PID: concurrent starts can fail with EADDRINUSE. The credential is not durably configured across restarts and is not transferable through the repository. Obtain runtime credentials through an approved secure channel; never copy chat secrets into files, commits, notes or logs.

The teacher `netanelyosef8` reported offline at the last check. Waiting for a teacher to return is not live audio ingestion. Verify rising audio/frame/transcript/event counters before reporting active study.

Public LIVE readiness is incomplete: output, audio and owner chat were disconnected at inspection. A local dashboard, 99/100 offline evaluation or a candidate summary does not establish public broadcast readiness. Do not start a public broadcast on stale readiness claims.

There are concurrent uncommitted camera/cloud/PWA changes in the working tree. Preserve them; do not assume their author or deployment state and do not execute deployment scripts just because they exist.

## Coordination with the receiving Dot

The owner relayed Dot's progress report, and the local operator independently confirmed 110 analyzed parts, 487 waiting parts and 42 lessons specifically in candidate status. The 44 total lessons also include one applied bundle and a legacy partial-source audit entry; these counts are compatible.

The provider ledger contained twelve unresolved reservations: eight `video_director_decision`, three `speech_transcription` and one `session_review`. They are reservations with unknown completion, not proof of twelve duplicate charges. The queue itself currently had no jobs marked `interrupted_request_outcome_unknown`.

The retry risk is real: the current library constructor changes interrupted `processing` jobs to `retry`, and timeout/failure handling can also retry requests whose provider outcome is uncertain. Dot reported reproducing this in an isolated test. Keep Dot as the designated investigator for that fix until its actual patch and test evidence are available; the local operator is not concurrently editing those retry paths.

Acceptance for the fix: an interrupted or ambiguous provider submission must not be silently resubmitted; preserve its evidence and reservation, distinguish definitely-not-submitted failures from unknown outcomes, keep healthy jobs progressing, require an explicit reconciliation decision where needed, and prove restart/batch behavior in tests. Never auto-release the twelve historical reservations merely to make totals match. The 48-request guard was an implementation safeguard, not a separately user-selected daily dollar budget; preserve existing spending ceilings and explain any proposed scheduling changes.

The relayed messages establish meaningful understanding and investigation, not a completed patch, deployed cloud worker, direct NotebookLM sync, or verified autonomous LIVE readiness. The local operator still does not have a verified direct thread identifier for the receiving Dot; do not message unrelated cloud tasks as a substitute.

## What the receiving Dot must demonstrate

1. Identify its actual repository checkout and commit; confirm whether the private corpus and persistent queue are accessible there.
2. Report real service status, source availability, queue blocker and credential readiness using sanitized results.
3. Explain the difference between source ingestion, AI interpretation, applied guidance, offline test results and verified live behavior.
4. Name a concrete next change and its acceptance test. Run it, retain the result and show a measured outcome or exact blocker.
5. Give evidence of one end-to-end source-to-candidate-to-guidance-to-rehearsal flow before claiming autonomous improvement.

Use the existing tests from `ariel_live`: `npm test`. The last full local suite passed 255 tests; rerun relevant checks against the receiving checkout. Keep reports concise and distinguish current measurements from this historical snapshot.
