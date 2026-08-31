# Audit: Session diagnostics page — existing data & gaps

**Status:** Audit only — no implementation in this pass.  
**Audience:** Alex + team (review before any diagnostics design)  
**Date:** 2026-08-12  
**Scope:** What data already exists to power a read-mostly  
`/admin/sessions/[id]/diagnostics` page for live stuck-session triage.  
Findings + gap list only — no build plan.

**Route note:** Today, admin session UI lives under  
`/admin/shows/[showId]/sessions/[sessionId]` (no  
`/admin/sessions/[id]` tree). A new `/admin/sessions/...` path would be  
greenfield; confirm collision before building (see commit 1175193 lesson).

---

## 1. Session ↔ Recall linkage

### 1.1 Firestore `SessionDoc`

Typed fields related to Recall (`types/index.ts`):

| Field | Present? | When written |
| --- | --- | --- |
| `recordingId?: string` | Yes | On `sdk_upload.complete` via `markSessionEndedFromRecall` — **not** at bind/start |
| `audioStoragePath?: string` | Yes | Same moment (after server-side audio store) |
| `audioStoredAt?: Timestamp` | Yes | Same moment |
| `uploadId` / `sdkUploadId` | **Absent** | — |
| `botId` | **Absent** | Desktop SDK path; bots are meeting-bot only |

Comment on `SessionDoc.recordingId` says “bound at start / written again on
complete,” but **bind does not write Firestore**. During a live show,
`SessionDoc.recordingId` is typically empty until ended.

### 1.2 What Recall returns on `createSdkUpload`

`electron-spike/lib/recallApi.js` → `POST /api/v1/sdk_upload/`:

```js
return {
  id: json.id,                 // sdk_upload id
  uploadToken: json.upload_token,
  recordingId: json.recording_id,
}
```

Create body includes `metadata: { sessionId, source: 'onda-electron-spike' }`.  
Same shape from `POST /api/recall/sdk-upload` (Next spike helper).

### 1.3 Where those IDs are written today

After create, Electron calls `POST /api/tech/sessions/bind-recording` with
`recordingId` + `uploadId` (`electron-spike/main.js`).

`bindRecording` (`lib/tech/sessionLifecycle.ts`) writes **RTDB only**:

| Path | Fields |
| --- | --- |
| `liveSessions/{sessionId}` | `recordingId`, `uploadId`, `showId` (merged onto existing live node) |
| `recordingIndex/{recordingId}` | `sessionId`, `showId`, `uploadId`, `boundAt` |

**Not written at bind:** Firestore `SessionDoc`.

**Natural place to add durable linkage for diagnostics:**

1. **Already partially there (ephemeral):** RTDB  
   `liveSessions/{sessionId}.{recordingId,uploadId}` +  
   `recordingIndex/{recordingId}` — usable while the session is live; wiped
   when `onSessionEnd` deletes `liveSessions/{sessionId}` (and reset clears
   the index).
2. **Natural durable addition:** write `recordingId` + `uploadId` onto
   Firestore `SessionDoc` at bind time (not only on complete), so admin
   diagnostics still works after RTDB cleanup / mid-failure.

---

## 2. Webhook payload contents

Two handlers (do not conflate):

| Endpoint | Auth | Role |
| --- | --- | --- |
| `POST /api/recall/webhook` (`lib/recall/workspaceWebhook.ts`) | Svix (`RECALL_SVIX_SIGNING_SECRET`) | Workspace lifecycle + optional transcript |
| `POST /api/webhook/[sessionId]` | `x-recall-secret` | Per-session Electron forwarder |
| CF `functions/src/recallWebhook.ts` | `x-recall-secret` | Transcript chunks → RTDB only (no Svix lifecycle) |

### 2.1 `sdk_upload.complete` (docs + our fixtures)

Official Recall payload (docs; mirrored in verify scripts):

```json
{
  "event": "sdk_upload.complete",
  "data": {
    "data": { "code": "complete", "sub_code": null, "updated_at": "..." },
    "recording": { "id": "<uuid>", "metadata": {} },
    "sdk_upload": { "id": "<uuid>", "metadata": {} }
  }
}
```

- **No top-level `sessionId`.**
- Docs / our comments: `metadata` is often `{}` even when create-upload set
  `metadata.sessionId` — **do not rely on metadata alone**.
- Our workspace handler resolves session **only** via  
  `recordingIndex/{data.recording.id}` (`resolveSessionIdFromRecordingId`).
- Event name in docs/code is **`sdk_upload.complete`** (not `.completed`).
  Other `sdk_upload.*` events are acknowledged and skipped (ended only on
  complete).

### 2.2 Other Svix events (`recording.done`, `transcript.done` /
`transcript.failed`, `participant_events.done`)

Per Recall recording-webhook docs, these carry Recall IDs, not our sessionId:

| Event | IDs in payload | Our `sessionId`? |
| --- | --- | --- |
| `recording.done` / `.failed` / … | `data.recording.id`, `data.bot.id` (+ status) | No |
| `transcript.done` / `.failed` / … | `data.transcript.id`, `data.recording.id`, `data.bot.id` | No |
| `participant_events.done` | Artifact + recording (same pattern) | No |

Matching any of these back to an Onda session **requires** existing
linkage (`recordingIndex` and/or Firestore `recordingId`). Workspace
handler currently treats non-`sdk_upload.*` / non-transcript events as
`skipped` (200) when they lack `sessionId` / transcript shape.

**Bot id:** Desktop SDK recordings have `bot: null` on Retrieve Recording;
bot-centric fields are not useful for Operator sessions.

---

## 3. Transcript data current state

### 3.1 Live RTDB path (canonical)

```
liveSessions/{sessionId}/chunks/{pushId}
```

Helpers: `rtdbLiveSessionPath` / `rtdbLiveSessionChunksPath` in
`lib/rtdbPaths.ts`. Also written by CF `recallWebhook` and Next
`/api/webhook/[sessionId]` / workspace transcript branch.

Chunk shape (`RTDBChunk`):

```
text, sequenceNumber, timestamp (unix ms), speakerLabel?,
translations { es?, pt?, fr? }, isFinalized
```

Keys are Firebase **push IDs**, not sequence numbers.

Live session meta on the same node (examples): `feedState`, `showId`,
`startedAt`, `recordingId`, `uploadId`, `stoppingAt`, `endedAt`, …

### 3.2 Gap detection from chunk data?

| Signal | Usable today? | Caveat |
| --- | --- | --- |
| `sequenceNumber` | **Only if Electron forwarder assigned it** | Electron increments a counter and stamps each forwarded chunk. Native Recall envelopes default to `sequenceNumber: 0` in `normalizeToOndaPayload`. |
| `timestamp` | Weak heuristic | Wall-clock receive time, not media time; gaps ≠ missing seq |
| Push key order | Not sequential content | Auto-IDs ≈ time order, not utterance seq |

So: **monotonic gap detection (14 then 52) is possible only on the
Electron-forwarded path**, and only with new read-side logic (nothing
implements gap detection today). Dual-path or native-only delivery would
make sequence gaps unreliable.

### 3.3 Final / archived form

| Store | What | When |
| --- | --- | --- |
| RTDB `liveSessions/.../chunks` | Live source of truth | While live / stopping |
| Firestore `shows/{showId}/sessions/{sessionId}/transcripts/` | Migrated chunks | `onSessionEnd` when RTDB `feedState` → `ended` |
| Firebase Storage | **Audio only**  
  `shows/{showId}/sessions/{sessionId}/audio/{recordingId}.mp3` | On Svix `sdk_upload.complete` + retrieve |
| Recall transcript download URL | Available on Retrieve Recording `media_shortcuts.transcript` | Not persisted by us into Storage |

After end, RTDB live node is **deleted**. Until then, RTDB chunks remain
the live source of truth. Reviewer pipeline is not built; Firestore
transcripts subcollection is the post-end archive.

---

## 4. Recall API read access

### 4.1 Endpoints relevant to diagnostics

| Endpoint | Purpose | Used in repo? |
| --- | --- | --- |
| `GET /api/v1/sdk_upload/{id}/` | Upload status (`pending` → `complete` / `failed`), `recording_id`, `metadata`, `status.sub_code` | **No callers** (create only) |
| `GET /api/v1/recording/{id}/` | Recording status, `media_shortcuts` (audio/transcript URLs + artifact status), times, `desktop_sdk_upload` | **Yes** |

### 4.2 Existing reusable code (recording retrieve)

- `electron-spike/lib/recallApi.js` → `retrieveRecording`
- `lib/recall/retrieveAndStoreAudio.ts` → retrieve + Storage upload
- `app/api/recall/recordings/[recordingId]/route.ts` → spike GET proxy
- `probeRecallRecordingForReset` in `sessionLifecycle.ts` → status probe on admin reset

These surface `status`, download URLs, and shortcuts. **Duration / file
size** are not extracted as first-class fields in our wrappers today;
raw Recall JSON is available (`raw` / `retrieveJson`) if needed.
**sdk_upload retrieve** would be new thin client code (same auth pattern
as recording retrieve: `RECALL_API_KEY` + `RECALL_REGION`).

---

## 5. Svix API access

**Confirmed: no Svix Management / Message API credentials in the app.**

What exists:

- npm package `svix` used only for **webhook signature verification**
- Env: `RECALL_SVIX_SIGNING_SECRET` (endpoint signing secret `whsec_…`) in
  `.env.example` / App Hosting secrets comments — **not** a Svix API token
- No `SVIX_API_KEY`, App Portal token, or similar in `.env*`,
  `apphosting.yaml`, Cloud Functions source, or docs

Viewing delivery failures in the Svix dashboard today has **no in-app
equivalent**. Diagnostics that need “list failed deliveries for this
recording/upload” would require new Svix API credentials + integration.

---

## Gap list (what would need to exist before building diagnostics)

Minimum gaps implied by the findings above (not a build plan):

1. **Durable Firestore linkage at bind time**  
   Persist `recordingId` + `uploadId` on `SessionDoc` when bind succeeds
   (today: RTDB-only until ended). Optional: clear/update on reset
   (reset already deletes `recordingId` / index).

2. **Stable ID for sdk_upload status polls**  
   `uploadId` must be readable by admin for a live session (Firestore or
   still-present RTDB). Without it, only recording retrieve works — and
   Firestore may lack `recordingId` until complete.

3. **sdk_upload retrieve client**  
   New `GET /api/v1/sdk_upload/{id}/` helper (none exists); recording
   retrieve can be reused/extended for media/status.

4. **Session resolution for non-complete Svix events**  
   Already possible via `recordingIndex` / `recordingId` if bind ran;
   workspace handler does not persist or surface those events today.

5. **Transcript gap detection logic**  
   New read-side analysis over RTDB chunks; only trustworthy when
   Electron stamped `sequenceNumber`. Decide whether diagnostics assumes
   that path.

6. **Svix API token (optional, for delivery forensics)**  
   Only if the page should show Svix delivery attempts / failures
   in-product. Signing secret alone cannot list messages.

7. **Route placement**  
   Confirm target path vs existing  
   `/admin/shows/[showId]/sessions/[sessionId]` to avoid collisions.

8. **Post-end RTDB absence**  
   Live chunk diagnostics only work while `liveSessions/{id}` exists;
   after end, read Firestore `transcripts/` (and Storage audio path).

---

## Source map (quick)

| Concern | Primary files |
| --- | --- |
| SessionDoc fields | `types/index.ts` |
| Bind / resolve / end | `lib/tech/sessionLifecycle.ts`, `app/api/tech/sessions/bind-recording/route.ts` |
| Electron create + bind | `electron-spike/lib/recallApi.js`, `electron-spike/main.js` |
| Svix workspace webhook | `lib/recall/workspaceWebhook.ts`, `app/api/recall/webhook/route.ts` |
| Per-session webhook | `app/api/webhook/[sessionId]/route.ts` |
| RTDB paths | `lib/rtdbPaths.ts`, `database.rules.json` |
| Chunk migrate | `functions/src/onSessionEnd.ts` |
| Audio retrieve | `lib/recall/retrieveAndStoreAudio.ts` |
| Svix verify only | `lib/recall/verifySvix.ts`, `.env.example` |
