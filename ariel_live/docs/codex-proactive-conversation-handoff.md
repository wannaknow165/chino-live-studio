# Proactive conversation update - tested, deployment pending

User wants the lion to lead conversation with the opposing player and audience, Hebrew or English, instead of only waiting for addressed questions.

Changes in video-director.mjs and video-director-provider.mjs:
- Internal director_cadence events explicitly marked hostInitiated; model treats them as hosting opportunities, never as words supposedly heard from a player.
- During quiet gaps (6.5 seconds since input, 8 seconds since a finished turn, at least 18 seconds between attempts), initiate one short question to the known opposing player, or in explicit battle mode / observed battle context.
- Last identified opposing player's language carries into initiative. Unknown language defaults to Hebrew.
- At most two unanswered opponent approaches; then an audience transition if the live audience source is enabled. Real opponent input resets this count.
- Current speech, a real queued turn, microphone transcription/listening, media effects, stage absence and manual mode take precedence.
- Cadence opportunities retain unique IDs but bypass text-duplicate suppression for internal prompts. Recorded clips still retain repeat cooldown, GPT semantic validation and existing shared budget/generation gates.
- Missing initiative replies are visible in owner help list.

Validation: 241 top-level Node tests pass. Includes bilingual initiation, no speech overlap, quiet-gap spacing, two-attempt pivot and continued audience activity without requiring a new chat event each time.

DEPLOYMENT: not loaded into the currently running Node process yet. Live listening is active. User was asked whether to apply now (requiring re-share audio) or at the next live stop. Do not claim the current live runtime already uses this update, and do not interrupt it before the timing choice is received.
