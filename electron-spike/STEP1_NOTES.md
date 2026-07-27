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
stopping               --sdk_upload.complete-->  ended
```

- **Start:** API validates not already `live` / `stopping`, writes Firestore + RTDB.
- **Stop button:** API sets `lifecycleStatus=stopping` only — never `ended`.
- **Ended (local spike only today):** Electron forwards a synthetic `sdk_upload.complete`
  to `/api/webhook/{sessionId}` after Retrieve Recording succeeds (or poll times out).
  That sets RTDB `feedState=ended` (+ Firestore `ended` for local verification).

### NAMED STEP 2 REQUIREMENT — real Svix lifecycle path

**`ended` state transition is verified locally via the Electron forwarder only.**
The real **Svix → `/api/recall/webhook`** path does **not** exist yet (no Recall
dashboard endpoint configured, no Svix signature verification in code) and is
**required before this works on an actual show.** Do not assume lifecycle
completion is solved for production traffic.

Step 2 must ship, as named work:
1. Register one workspace Svix endpoint → public `POST /api/recall/webhook`
2. Verify Svix signatures (not `x-recall-secret`)
3. Resolve session via `recordingIndex/{recordingId}` (and/or verified metadata)
4. Confirm `sdk_upload.complete` (not `recording_ended`) flips `ended` without Electron

## Firebase project hard block (not just `/api/health`)

On Electron launch, main process calls `GET /api/health` **before** unlock is usable:

- Wrong / missing project → `projectCheckOk = false`, fatal banner in UI, **SDK init skipped**
- `spike:unlock` **refuses** if `!projectCheckOk` — you cannot get past the unlock screen
- Start recording also refuses on the same flag

So “hard fail” means **physically blocked at unlock**, not merely “an endpoint would tell you if you checked.”

Admin init (`assertCorrectFirebaseProject`) also throws if any Next route tries to use the wrong project.

## `bind-recording` timing gap

`recordingId → sessionId` is written **after** `createSdkUpload` returns, via
`POST /api/tech/sessions/bind-recording` → RTDB `recordingIndex/{recordingId}`.
It is **not** written at `startSession` (no recordingId exists yet).

**What can arrive in that window?** Practically nothing that needs the index:

- Transcripts go to `/api/webhook/{sessionId}` with the path param — they do **not**
  use `recordingIndex`. A chunk before bind lands is still written under the correct session.
- Svix `sdk_upload.complete` cannot arrive before upload creation finishes, and in
  practice not before recording ends — long after bind.
- Optional Recall realtime webhook (only if `ONDA_PUBLIC_WEBHOOK_BASE` is set) also
  uses the per-session URL, not the index.

If bind itself fails, Electron logs a warning; local `ended` still works via the
forwarder (path sessionId). The index only matters once the real Svix path exists.

## Recall webhook signal quality

1. **Best ended signal:** `sdk_upload.complete`. We do **not** flip to `ended` on
   `sdk_upload.recording_ended` (capture stopped; upload may still run).
2. **Metadata unreliable in docs:** Svix examples show empty `metadata: {}` — do not
   rely on metadata alone for multi-room; use `recordingIndex`.
3. **Svix auth:** not implemented (missing, not stubbed). Fine for local forwarder;
   not fine for real Svix traffic.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + `cre8ion-onda` guard (Electron blocks unlock on failure) |
| POST | `/api/tech/unlock` | `{ credential }` → show + sessions |
| POST | `/api/tech/sessions/start` | `{ credential, showId, sessionId }` → live |
| POST | `/api/tech/sessions/stop` | → stopping (not ended) |
| POST | `/api/tech/sessions/bind-recording` | recordingId ↔ session (after sdk_upload) |
| POST | `/api/webhook/[sessionId]` | Transcripts + local lifecycle complete forward |
| POST | `/api/recall/webhook` | Legacy / intended Svix target (handler ready; endpoint not wired) |

## Mac verification checklist

1. Root `.env.local`: `NEXT_PUBLIC_FIREBASE_PROJECT_ID=cre8ion-onda`, Admin SA, `RECALL_WEBHOOK_SECRET`
2. Show in Firestore has `techCredential` set; sessions under that show
3. `npm run dev` + `cd electron-spike && npm start`
4. Unlock → list sessions → pick one in ready/preproduction → Start
5. Confirm Firestore `lifecycleStatus=live`, speak → RTDB `liveSessions/{id}/chunks`
6. Stop → Firestore `stopping` immediately; after audio ready / Electron forwarder → `ended`
7. Confirm MP3 under `electron-spike/downloads/`
8. (Negative) Point env at `-503301` → fatal banner, unlock blocked
