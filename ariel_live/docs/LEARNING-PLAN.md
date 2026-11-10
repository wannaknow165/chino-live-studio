# Full live-host learning: next implementation scope

## Inputs, each with independent identity and lifecycle

1. Teacher TikTok live: username/room and Hebrew/English/auto language; reuse stream capture and keep observation-only as the starting mode.
2. Teacher chat/events: reuse configured TikTools service with a separately identified room. Preserve raw/unknown event types and distinguish direct protocol events from inferred battle phases. Do not disconnect the owner's own audience subscription.
3. Isolated application audio: explicit user-selected shared application audio; distinguish teacher, opponent, personal mic and music. A selected track is not proof of actual sound or valid transcription.
4. Microphone practice: separate practice source, never relabel it as a real teacher stream.
5. Existing media files: bounded replay with a source file hash and timestamps, not a live-room subscription.

The existing 7777 learning screen already has a teacher username entry, stream start/stop and observation status. New multi-teacher connectors must extend this rather than rebuilding it. Actual simultaneous independent teacher-chat delivery still needs implementation and verification.

## Timeline analysis

Use shared source timestamps for chat, gifts, battle events, speech and frames. Annotate utterances and one-minute summaries with the exact supporting ranges. Audio analysis includes observed voiced segments, pauses, audible breath/exhalation/laugh events, speaking tempo, pitch range, intensity, overlap and response latency. Compressed/mixed audio can hide these; confidence and unknown fields are required. Do not infer a person's real mental state from a tone label.

## Host scene model

States: unknown, solo_audience, opponent_arrives, introductions, pre_game_chat, game_offer, rule_agreement, battle_active, battle_result, audience_return, interruption, technical_help.

For every transition retain: teacher/source identity, language, before/after state, trigger evidence, addressee, actual words/actions, quiet gaps, interruption, outcome and uncertainty. A score/countdown must come from fresh structured evidence; derived phases must be labelled derived.

## Training-to-runtime gate

Capturing or summarizing does not change model weights. Review candidates into the existing response index, owner notes, scene policies and motion cues. Evaluate held-out Hebrew/English/mixed turns, recipient correctness, meaningful semantic bank reuse, no repeated questions, interruptibility, response timing, uncertainty handling and spending before enabling a policy. Use the current approved original character voice; analysing a teacher's prosody does not create a deployable voice clone.

## Runtime objective

A proactive host that greets, asks a short question, changes topic when ignored, proposes a game, follows the real battle phase and returns to audience engagement. Let people finish speaking. Choose a suitable existing recording first; generate a verified missing response within the approved cap; signal owner help for uncertainty or a stuck provider. Never fill silence with an unrelated clip or invent a participant answer.
