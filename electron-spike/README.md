# Onda Operator — Electron + Recall Desktop SDK

Onda Operator captures in-person / adhoc audio via Recall Desktop SDK and
drives session `feedState`: `standby → testing → live → stopping → ended`.

Flow: **techCredential unlock → session select (non-draft) → sound check →
Go Live → End → webhook `ended`**

See `SLICE_2B_PLAN.md` for the full state model and UI contract.

## Requirements

- **macOS** (primary; Tahoe 26.x Settings deep-links). Windows supported by SDK but not fully validated.
- Node 20+
- Recall API key + region
- Next.js (`npm run dev`) with:
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID=cre8ion-onda` (**hard fail otherwise**)
  - `RECALL_WEBHOOK_SECRET`
  - Firebase Admin credentials
  - Show documents with `techCredential` + sessions (`isDraft: false` to appear)

## Setup

```bash
# 1) Next.js (repo root)
cp .env.example .env.local
# fill Firebase (cre8ion-onda only) + GOOGLE_APPLICATION_CREDENTIALS + RECALL_WEBHOOK_SECRET
npm run dev

# 2) Electron — local dev
cd electron-spike
cp .env.example .env
# fill RECALL_*, ONDA_API_BASE, and NEXT_PUBLIC_FIREBASE_* (client config only)
npm install
npm start   # injects config → builds React renderer → launches Electron
```

### Windows installer (build-time config)

Packaged installs bake config into the `.exe` — target machines need **no** `.env`.

```bash
cd electron-spike
cp .env.build.example .env.build
# fill production values (ONDA_API_BASE=https://cre8ion-onda.app, secrets, NEXT_PUBLIC_*)
npm run build:win
```

### Mac installer (same build-time config)

```bash
cd electron-spike
# reuse the same .env.build as Windows
npm run build:mac
# output: dist/*.dmg (unsigned; Gatekeeper will prompt on first launch)
```

`.env.build` is gitignored (`.env*` pattern). The inject step writes
`lib/buildConfig.generated.json` (also gitignored) which is packaged into the asar.

### Firebase client env (renderer RTDB caption preview)

Copy the same **public** `NEXT_PUBLIC_FIREBASE_*` values used by the Next app into
`electron-spike/.env` (local) or `.env.build` (installer). These are **not** Admin SDK /
service-account credentials:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL`

## Operator flow

1. **Unlock** — show `techCredential`
2. **Select session** — drafts (`isDraft=true`) are omitted
3. **Enable sound check** — `feedState → testing` + Recall `startRecording`
4. **Go Live** — `feedState → live` (same continuous take)
5. **End session** — optimistic `stopping`; webhook → `ended`

## Slice 2B Step 0 — audio concurrency spike

- Docs: `AUDIO_CONCURRENCY_SPIKE.md`
- Open: diagnostics `⌘⇧D` → **Audio concurrency spike**, or `#audio-concurrency-spike`
