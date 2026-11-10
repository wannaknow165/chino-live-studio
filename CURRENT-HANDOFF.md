# CHINO / ARIEL continuation — 2026-11-10

## Existing implementation

- Primary AI director: `ariel_live/auto-host-server.mjs`, port 7780. Separate existing effects/learning server: `ariel_live/server.mjs`, port 7777. Root React narrator is separate.
- The video-bank system uses GPT semantic interpretation and alternative-answer review before automatic paid generation. Existing OpenRouter transport, exact-word/quality verification, conservative shared $15 live cap and no-repeat handling for uncertain submissions must be preserved.
- Private owner chat now calls restricted application tools to set solo/battle/auto scene mode, save a correction, queue exact owner lines or answer a pending gap. Do not replace it with prose that claims an action occurred without executing it.
- Solo audience chat needs no wake prefix. Battle chat starts with Chino; the same stable viewer may follow up for two minutes after actual playback ACK. Opponent audio also has a two-minute followup window.
- Proactive conversation code initiates brief Hebrew/English opponent questions during quiet gaps and pivots to the audience after two unanswered approaches. Current speech/queued turns/effects take precedence. Never promise continuous correct speech or claim unheard replies.
- Existing effects: `chicken_blow`, `dancer_side_dance`, `baby_bottle_feed`, `tiny_on_paw` plus legacy tracking presets. Tiny uses alpha feet observed in each source frame, independent real-face overlay, reviewed paw path, two source passes and a shared 3.4x closeup. Actual Miriam send reached playing then completed/rendered true. Baby has separate mouth tracking and original crying audio. Preserve alpha, original faces, source hashes and output-owner ACKs.
- Current rig from local config is seated-wardrobe, with seated-denim-chair throne and royal-hero-v12 design reference. These and editable sources are retained.

## What is not established

No verified public TikTok broadcast or real opponent transcription was established by the latest recorded acceptance. A local API, preview or saved flag is not proof of real camera/broadcast output. Provider credentials and room subscriptions must be checked on the Mac. The Windows virtual camera is not a Mac virtual camera.

## Latest owner direction: full bilingual live-host learning

A connected training live is a TEACHER, not automatically a participant to answer. Keep teacher observation separate from the live opponent/audience input. Reuse the existing learning archive, `LearningStore`, `/api/stream/start`, `/api/training`, audio/frame capture and TikTools event normalization. Do not silently retarget the owner's live-chat subscription to a teacher.

The owner wants detailed timestamp-aligned analysis of teacher speech, audience chat, event/battle data, visual actions, pacing, laughter, audible breaths/exhalations, pauses, pitch and intensity. Observations and model interpretations need evidence intervals, source modality, speaker attribution quality and confidence. Missing/noisy/overlapping audio remains unknown. Store style/pacing candidates, not a claim that the character has learned a validated skill or a copied human voice.

The target is autonomous hosting with scene transitions: solo audience hosting; new opponent joins; greeting/introductions; talking before a game; proposing/accepting rules; active battle; result/celebration; returning to audience; interruptions/unclear inputs/provider failure. Each example should preserve trigger -> state -> addressee -> spoken/action response -> timing -> observed outcome. Include Hebrew and English and mixed-language turns. Training analysis should drive evaluated policies/retrieval examples, not replay raw transcripts as instructions.

See `ariel_live/docs/LEARNING-PLAN.md` for the next implementation scope. The new multi-source teacher connectors, full prosody analysis and evaluated autonomous state policy are NOT implemented or end-to-end verified merely by this handoff.

## Migration and privacy

Read `README-MAC.md`. Sanitized seeds include 30 usable bank entries and 12 learned song-motion entries. Private chat/participant memory, learning recordings, browser state, tokens and live request histories stay local. Reconnect services securely. Original Windows files remain in place. Only active assets/current rig are selected; no historical archive.

## Validation

Run `cd ariel_live && npm test`. The runner deliberately selects only top-level test files, excluding old backup copies. Verify the clean-clone bootstrap and Git LFS assets before resuming work. Source handoff notes in `ariel_live/docs/` describe earlier dated checks; this file is the current entry point.
