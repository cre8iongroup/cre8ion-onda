# Electron + Recall Desktop SDK — Adhoc / In-Person Spike

Minimal Electron shell that proves the Onda capture loop:

**mic → Recall Desktop SDK (adhoc) → webhook → RTDB chunks → Retrieve Recording (full audio)**

This is a proof-of-concept, not production. No code signing, no Tech Panel UI, no auth.

## Requirements

- **macOS Apple Silicon** (primary). Windows is supported by the SDK but not validated in this spike.
- Node 20+
- Recall API key + region
- Onda webhook reachable locally (`npm run dev`) with:
  - `RECALL_WEBHOOK_SECRET`
  - Firebase Admin credentials (`GOOGLE_APPLICATION_CREDENTIALS` or ADC)
  - `NEXT_PUBLIC_FIREBASE_DATABASE_URL`

## Setup

```bash
# 1) Next.js (repo root) — webhook + optional sdk-upload helpers
cp .env.example .env.local   # or edit existing
# fill Firebase + GOOGLE_APPLICATION_CREDENTIALS + RECALL_WEBHOOK_SECRET
# (optional RECALL_API_KEY / RECALL_REGION if using Next helpers)
npm run dev

# 2) Electron spike
cd electron-spike
cp .env.example .env
# fill RECALL_API_KEY, RECALL_WEBHOOK_SECRET (same secret as root), SESSION_ID
npm install
npm start
```

## What the buttons do

1. **Start recording**
   - `POST /api/v1/sdk_upload/` with `recallai_streaming` + `desktop_sdk_callback`
   - `prepareDesktopAudioRecording()` → `windowId`
   - `startRecording({ windowId, uploadToken })`
2. **Realtime**
   - Listens for `realtime-event` / `transcript.data`
   - Normalizes and `POST`s to `ONDA_WEBHOOK_URL` with `x-recall-secret`
3. **Stop + retrieve audio**
   - `stopRecording()`
   - Polls Retrieve Recording until `audio_mixed` / `audio_mixed_mp3` download URL appears
   - Saves file under `electron-spike/downloads/`

## Offline checks (no Mac / no mic)

```bash
cd electron-spike && npm run verify-normalize

# With Next.dev + secrets:
RECALL_WEBHOOK_SECRET=... npx tsx scripts/verify-recall-webhook-shapes.ts
```

## Permissions (macOS)

On first run you should see prompts related to:

1. **Microphone** — Electron `askForMediaAccess` + Recall `requestPermission("microphone")`
2. **System audio** — Recall `requestPermission("system-audio")` (relevant for speaker mix in adhoc)
3. **Accessibility** / **Screen Recording** — still requested for parity with Recall meeting-mode guidance; log whether adhoc actually requires them

Adhoc mode captures system mic + speaker mix; it does **not** use `meeting-detected`.

## Windows

The SDK supports Windows and does not need the macOS permission trio. Add a Windows smoke test after Mac validation — not blocked by code structure, but not run in this spike.

## Important: Phase 4 webhook compatibility

Phase 4 expected a **custom** JSON body (`sessionId`, `text`, …). Native Recall realtime events use a nested `transcript.data` envelope. This spike:

- Forwards **normalized** Onda payloads from Electron (works with Phase 4 secret header as-is)
- Also teaches `/api/recall/webhook` + `recallWebhook` CF to accept the **native** envelope when `?sessionId=` is present

See `SPIKE_REPORT.md` for what was / was not verified in CI/cloud.
