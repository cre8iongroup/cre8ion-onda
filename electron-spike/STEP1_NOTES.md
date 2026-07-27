# Spike / Step 1 implementation notes
# (Tech Operator Panel — Electron session lifecycle)

## What changed vs the Phase 4 spike

| Before | After |
| --- | --- |
| Hardcoded `SESSION_ID=spike-test-session` | Unlock via `shows.techCredential` → list real sessions |
| Fixed `ONDA_WEBHOOK_URL` | Per-session `POST /api/webhook/[sessionId]` |
| Electron starts SDK immediately | Electron calls `POST /api/tech/sessions/start` first |
| Stop only halts SDK | `POST /api/tech/sessions/stop` → `stopping`; `ended` later |
| Soft warn on wrong Firebase project | Hard fail if project ≠ `cre8ion-onda` |

## Lifecycle state machine (Step 1)

```
preproduction / ready  --startSession-->  live
live                   --stopSession--->  stopping   (feedState: paused)
stopping               --sdk_upload.complete webhook-->  ended
```

- **Start:** API validates not already `live` / `stopping`, writes Firestore + RTDB.
- **Stop button:** API sets `lifecycleStatus=stopping` only — never `ended`.
- **Ended:** Triggered by `sdk_upload.complete` on the webhook (see below). That sets
  RTDB `feedState=ended`, which also drives `onSessionEnd` CF when deployed.

## Recall webhook signal quality — FLAG FOR STEP 2

1. **Best ended signal:** `sdk_upload.complete` (upload finished; media retrievable).
   `sdk_upload.recording_ended` only means capture stopped — upload may still run.
   We intentionally do **not** flip to `ended` on `recording_ended`.

2. **Metadata is unreliable in docs:** Recall’s documented Svix payloads show
   `sdk_upload.metadata: {}` and `recording.metadata: {}` even when create-upload
   set `metadata.sessionId`. **Do not rely on metadata alone** for multi-room.

3. **Mitigation shipped:** After create-upload, Electron calls
   `POST /api/tech/sessions/bind-recording` which writes
   `recordingIndex/{recordingId} → { sessionId, showId }`. Workspace-level Svix
   endpoints hitting `/api/recall/webhook` resolve session via that index.

4. **Local/spike fallback:** After Retrieve Recording returns an audio URL (or
   poll times out), Electron **forwards** a synthetic `sdk_upload.complete` to
   `/api/webhook/{sessionId}` with `x-recall-secret`. Production should also
   configure Recall dashboard Svix → a public Onda URL. Until Svix is wired and
   verified to echo metadata or always include recording.id we can index, the
   Electron forwarder is the practical local path.

5. **Svix auth vs our secret:** Dashboard Svix webhooks do **not** send
   `x-recall-secret`. Step 2 should add Svix signature verification for the
   workspace lifecycle endpoint; today lifecycle posts still expect the shared
   secret (Electron forwarder / tunneled tests).

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + **loud** `cre8ion-onda` project guard |
| POST | `/api/tech/unlock` | `{ credential }` → show + sessions |
| POST | `/api/tech/sessions/start` | `{ credential, showId, sessionId }` → live |
| POST | `/api/tech/sessions/stop` | → stopping (not ended) |
| POST | `/api/tech/sessions/bind-recording` | recordingId ↔ session |
| POST | `/api/webhook/[sessionId]` | Transcripts + lifecycle complete |

## Mac verification checklist

1. Root `.env.local`: `NEXT_PUBLIC_FIREBASE_PROJECT_ID=cre8ion-onda`, Admin SA, `RECALL_WEBHOOK_SECRET`
2. Show in Firestore has `techCredential` set; sessions under that show
3. `npm run dev` + `cd electron-spike && npm start`
4. Unlock → list sessions → pick one in ready/preproduction → Start
5. Confirm Firestore `lifecycleStatus=live`, speak → RTDB `liveSessions/{id}/chunks`
6. Stop → Firestore `stopping` immediately; after audio ready / complete → `ended`
7. Confirm MP3 under `electron-spike/downloads/`
