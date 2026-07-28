# Electron + Recall Desktop SDK — Tech Operator Step 1

Minimal Electron shell for Onda in-person capture with **real** show unlock +
session lifecycle (no hardcoded `SESSION_ID`).

Flow: **techCredential unlock → session select → startSession API → Recall SDK →
per-session webhook → stopSession (stopping) → sdk_upload.complete → ended**

See `STEP1_NOTES.md` for lifecycle details and Recall webhook caveats.

## Requirements

- **macOS Apple Silicon** (primary). Windows supported by SDK but not validated here.
- Node 20+
- Recall API key + region
- Next.js (`npm run dev`) with:
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID=cre8ion-onda` (**hard fail otherwise**)
  - `RECALL_WEBHOOK_SECRET`
  - Firebase Admin credentials
  - Show documents with `techCredential` + `sessions` subcollection

## Setup

```bash
# 1) Next.js (repo root)
cp .env.example .env.local
# fill Firebase (cre8ion-onda only) + GOOGLE_APPLICATION_CREDENTIALS + RECALL_WEBHOOK_SECRET
npm run dev

# 2) Electron
cd electron-spike
cp .env.example .env
# fill RECALL_API_KEY, RECALL_WEBHOOK_SECRET, ONDA_API_BASE
npm install
npm start   # builds React renderer (Vite) then launches Electron
```

### Renderer (Stage 1 — React + Vite)

- Source: `renderer-src/` (React)
- Build output: `renderer/` (loaded by existing `main.js` via `loadFile`)
- Styles: `renderer-src/styles/onda.css` — tokens/primitives copied from `app/globals.css`
- IPC: unchanged — `preload.js` → `window.ondaSpike`
- Browser-only preview (no Electron): `npm run build:renderer && npm run preview:renderer`

## Operator flow

1. **Unlock** — enter the show’s `techCredential` (validated via `/api/tech/unlock`)
2. **Select session** — list shows current `lifecycleStatus` (ready/preproduction ≈ scheduled)
3. **Start** — calls `/api/tech/sessions/start` (rejects if already live) then Recall SDK
4. **Speak** — transcripts POST to `/api/webhook/{sessionId}` → RTDB chunks
5. **Stop** — `/api/tech/sessions/stop` → `stopping`; SDK stop + retrieve audio; then
   `sdk_upload.complete` flips session to `ended` (not on button click alone)

## Offline checks

```bash
cd electron-spike && npm run verify-normalize
```

## Slice 2B Step 0 — audio concurrency spike

Isolated harness (does not replace Stage 2A UI):

- **Plan (authoritative):** `SLICE_2B_PLAN.md`
- Concurrency audit / Mac runbook: `AUDIO_CONCURRENCY_SPIKE.md`, `SLICE_2B_AUDIT_AND_PLAN.md`
- Open in-app: diagnostics `⌘⇧D` → **Audio concurrency spike**, or `#audio-concurrency-spike`

## Non-goals (Step 2+)

Visual polish, reconnect handling, code signing, multi-session-per-device.
