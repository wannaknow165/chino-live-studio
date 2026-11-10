# CHINO audio rehearsal and approved media — 2026-11-10

Existing cloud runtime on port 7780 was updated in place, with file hashes checked and backups retained. No public broadcast was started. The effects service on port 7777 was not restarted.

## Evidence

- Local suite: 266 tests passed. Targeted cloud suite: 11 tests passed.
- Four synthetic recorded inputs went through the actual ASR, director, existing stage decoder and playback acknowledgement flow. All four selected and played an appropriate ready video.
- Cases: Hebrew name-only wake, Hebrew wellbeing, Hebrew identity, English wellbeing. Same-speaker follow-up works without repeating the wake name.
- Time from submitted recording to observed playback: 6.212, 3.771, 3.251, 3.248 seconds respectively. These are single-run measurements, not latency guarantees.
- The headless stage observed 208 playing-video samples, including 34 unmuted samples. Physical speakers, a human microphone and public TikTok delivery were not independently verified.
- Local detailed report: `data/video-director/audio-rehearsal-27972951-b88b-4cce-badb-56390d4551da.json` (runtime data, excluded from Git).

## Approved manual production

User approved one attempt per line, at most USD 1.15 each and USD 2.30 total.

- Hebrew “בכיף, בשמחה!”: submitted once; provider returned terminal generation failure. No retry was submitted. Provider did not report usage, so no zero-charge claim is made.
- English “I'm doing great. How about you?”: submitted once; completed, 5.035 seconds. Provider-reported video cost USD 0.34752, excluding AI validation. ASR exactly matched the approved text; automatic visual review scored 10 with stable identity and no reported defects. Registered for chat and opponent and played through the stage.
- Ready English media and its sanitized portable catalog entry are included in Git/LFS.

## Fixes

Recorded practice inputs retain synthetic provenance and are rejected during live capture. English replies cannot silently inherit Hebrew cached drafts. Wake-only meaning is separated from a general greeting cache entry. Old inactive LIVE session ceilings no longer block separately authorized manual checks; active LIVE and persistent project budget ceilings remain enforced. Terminal provider failures are persisted without automatic retry.

## Remaining acceptance boundary

This demonstrates recorded-audio-to-video response, not unattended public LIVE readiness. Actual opponent-audio capture, chat connection and physical output require current live evidence. The failed Hebrew clip remains missing; it has not been replaced by a relabeled recording. Direct NotebookLM synchronization and independently measured learning improvement remain separate unfinished work.
