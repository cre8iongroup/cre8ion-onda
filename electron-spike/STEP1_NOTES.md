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
- **Ended — local forwarder (gated):** Electron may forward synthetic `sdk_upload.complete`
  to `/api/webhook/{sessionId}` only when `ONDA_LOCAL_FORWARDER_ENABLED=true` (default **false**).
  DEFAULT DECISION — flagged for review; full removal once real Svix is live remains on the table.
- **Ended — authoritative Svix path:** Recall dashboard → `POST /api/recall/webhook` with
  Svix signatures (`RECALL_SVIX_SIGNING_SECRET`). Resolves `recordingIndex/{recordingId}` then
  `markSessionEndedFromRecall`. Live delivery still needs the staging custom domain registered
  in Recall’s dashboard (not done in this pass).

### Local verification (no live domain)

```bash
npx tsx scripts/verify-recall-svix-local.ts
```

Remaining for production traffic (domain-dependent):
1. Register workspace Svix endpoint → public `POST /api/recall/webhook`
2. Set Firebase secret `RECALL_SVIX_SIGNING_SECRET` from Recall dashboard
3. Confirm live `sdk_upload.complete` flips `ended` without Electron forwarder

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
3. **Svix auth:** implemented on `/api/recall/webhook` via official `svix` package +
   `RECALL_SVIX_SIGNING_SECRET`. Local forwarder still uses `x-recall-secret` on
   `/api/webhook/[sessionId]` only when `ONDA_LOCAL_FORWARDER_ENABLED=true`.

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
