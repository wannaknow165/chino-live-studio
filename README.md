# CHINO live project

For Mac setup and continuation, read [README-MAC.md](README-MAC.md) and [CURRENT-HANDOFF.md](CURRENT-HANDOFF.md). Active media and the current editable rig use Git LFS. Credentials and personal runtime data are excluded.

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

The existing live-character system is in `ariel_live/` and runs separately from
this React narrator app. For its current listening, offline transcription,
evidence archive, billing pause and remaining work, see
[the live learning handover](ariel_live/README-LEARNING.md).

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/507eae2c-bd50-4f68-8325-0657bd9c380c

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
