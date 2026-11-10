# Continue CHINO on a Mac

This private repository contains the existing narrator app and the current CHINO/ARIEL live system. The live system is in `ariel_live/`; the root React narrator is a separate app.

## Clone with active media and current rig

Prerequisites: Git, Git LFS, Node.js 24+, Python 3 and FFmpeg. The active asset selection is approximately 2.5 GiB, stored with Git LFS. Old Blender versions, failed/deleted generations, browser profiles, private conversations, original music archives and credentials are excluded.

```sh
git lfs install
git clone https://github.com/wannaknow165/chino-live-studio.git
cd chino-live-studio
git lfs pull
cd ariel_live
npm ci
npm run setup:local
npm test
npm start
```

Open http://127.0.0.1:7780/ . In another terminal, from `ariel_live/`, run `npm run effects` for the existing effects dashboard on http://127.0.0.1:7777/ . Setup copies sanitized catalog seeds only when local destination files are absent. It never overwrites existing local credentials, state or budget files, and does not start paid generation.

The root `start-mac.sh` is an alternative core launcher after setup. Python helpers that call `python` should run from an activated Python 3 virtual environment:

```sh
python3 -m venv .venv-learning
. .venv-learning/bin/activate
python -m pip install -r requirements-learning.txt
```

## Local credentials and spending

Keys, tokens, `.env` files, Spotify login and Windows browser sessions are deliberately not in Git. Configure OpenAI through the local dashboard settings on the Mac. OpenRouter uses the local ignored `ariel_live/data/settings.json` field `openrouterKey`; configure it locally without pasting a key into chat or committing it. The legacy root narrator uses `.env.example` as a template.

The portable seeds preserve cumulative conservative reservations and the existing live session ceiling, with automatic production disabled at startup. They are a point-in-time transfer, not a shared cross-machine ledger. Keep paid production on only one machine; do not run Windows and Mac generation simultaneously from copied budgets. No submitted/uncertain paid jobs are migrated or replayed.

## Platform boundary

The dashboard and Node logic can be developed on Mac. The current OBS virtual-camera frame bridge uses Windows APIs; this migration makes unsupported camera actions explicit instead of crashing at import. It does not implement a native Mac broadcast camera. Several legacy capture/Blender/face helpers still have Windows-specific paths or launchers; these need a targeted port before claiming full Mac live broadcasting. The existing Python ASR/model cache and Rhubarb binary are not transferred.

`performer-config.json` is generated with paths for the Mac checkout and the existing Three.js dependency. The current 3D asset, throne, design model and editable Blender sources are included; old versions and `.blend1` copies are excluded. Open the wardrobe scene in Blender for the current clothed rig.

## Continue in Codex

Open this repository folder in Codex on the Mac, then start with `CURRENT-HANDOFF.md`. Do not rebuild the system. Reuse current servers, bank, model transport, budget ledger, interaction compositor and output ownership. A Git clone does not transfer this chat's full history or authenticate provider accounts.

Actual macOS execution and public TikTok broadcast acceptance have not been verified on this Windows machine.
