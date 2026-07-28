# Slice 2B — Implementation plan (authoritative)

**Date:** 2026-07-28  
**Branch:** `cursor/slice-2b-audio-meter-spike-9d90`  
**Status:** Plan only — no Slice 2B production UI in this pass.  
**Prior Step 0 concurrency audit:** [`SLICE_2B_AUDIT_AND_PLAN.md`](./SLICE_2B_AUDIT_AND_PLAN.md) (provisional meter approach + Mac runbook). Mac live overlap still pending separately; DSP guardrails apply either way.

---

## 1. RTDB auth question — answered from rules + code

### Direct answer

**Electron does not need new auth plumbing (no custom token, no tech Auth sign-in, no server proxy) to read the live caption RTDB feed.**

Current Realtime Database rules (`database.rules.json`) already allow **unauthenticated public read** of both paths the preview needs:

```json
"liveSessions": {
  "$sessionId": {
    "feedState": { ".read": true, ".write": "auth != null" },
    "chunks":    { ".read": true, ".write": false }
  }
}
```

Comments in the rules file state this explicitly: chunks are public read so attendee UI can subscribe; attendee/output **must gate on `feedState` client-side**.

### What the techCredential Auth user actually is

| Path | What it does today |
| --- | --- |
| Synthetic Auth user `tech+{portalSlug}@onda.tech` | Provisioned for the **web** Tech panel (`/tech/login` → `signInWithEmailAndPassword`). Used for Firestore session reads and client-side `feedState` writes (`GoLiveControl`). |
| Electron unlock | **Does not sign into Firebase Auth.** Posts the shared secret to `POST /api/tech/unlock`, which matches `shows.techCredential` via **Admin SDK**. Session start/stop likewise go through API routes (Admin writes). |
| Electron Firebase client | **None today.** Renderer has no `firebase` init, no Auth, no RTDB listener. |

So: the synthetic tech user **would** have RTDB read access if signed in (public read ⊆ authenticated read), but that is irrelevant — **anonymous clients already can read `chunks` and `feedState`.** Caption preview only needs the Firebase **client SDK + `databaseURL`** in the Electron renderer (or a thin main-process bridge that still uses the public client SDK). No custom token. No proxy required for reads.

### What still needs Auth (or the existing API) — writes

| Action | RTDB rule | Electron today | Slice 2B recommendation |
| --- | --- | --- | --- |
| Read chunks / feedState | `.read: true` | N/A | Client SDK subscribe — **no Auth** |
| Write feedState (Go Live / End) | `.write: "auth != null"` | Via `/api/tech/sessions/*` Admin SDK | **Keep API writes** (matches Electron’s credential model; avoids shipping Auth into Electron solely for writes) |
| Write chunks | `.write: false` | Webhook / Admin only | Unchanged |

### Security note (already true for attendees)

Anyone who knows a `sessionId` can read transcript chunks during `testing`. That is the current rules design. **Phase 5 must gate attendee/output UI on `feedState` alone** — never on data presence — or test noise leaks. Do not “fix” this for Slice 2B by locking chunk reads unless product explicitly wants a rules change (would then force Auth or a proxy for attendees too).

---

## 2. Authoritative session state model

Two independent axes. **Single source of truth for live operation is `feedState`.** Every UI only formats it differently.

### Axis 1 — `isDraft` (boolean, admin-only)

| Value | Meaning |
| --- | --- |
| `true` | Invisible to Tech Operator Panel **and** Attendee PWA. Admin builds/edits privately. |
| `false` | Visible to tech + attendees. Does **not** imply anything about feed — feed starts at `standby`. |

Tech/attendee UIs never read/write `isDraft` for control (tech list/query filters it out; attendees never see draft sessions).

### Axis 2 — `feedState` (ordered machine)

```
standby → testing → live → stopping → ended
```

| Value | Meaning |
| --- | --- |
| `standby` | Published (`isDraft=false`), not capturing yet |
| `testing` | Real Recall `startRecording()`; audio/transcript to cloud; **not** attendee-visible as live |
| `live` | Audience-visible. **Same continuous Recall take** — no stop/restart |
| `stopping` | End clicked → leave `live` **immediately** (optimistic / API write). Short handshake, not the AI/export pipeline |
| `ended` | Stop confirmed (existing webhook / upload-complete path) |

No reset / stop-test. Dead air between test and Go Live accepted.

### Per-UI labels (format only — do not invent parallel status fields)

| feedState / isDraft | Tech Operator | Attendee PWA | Admin/Editor |
| --- | --- | --- | --- |
| `isDraft=true` | session hidden | session doesn't exist | **Draft** |
| `standby` | Standby | “[Title] starts at [Time] in [Room]” + QR/link | Ready |
| `testing` | Testing | **identical to standby** (must not distinguish) | Testing |
| `live` | Live | live captions | Live |
| `stopping` | Stopping | **identical to live** (finish-the-last-lines buffer; no visible change) | Stopping (distinct — stuck Stopping is an admin alarm) |
| `ended` | Ended | thank-you + closing branding | Ended |

### Out of scope (do not conflict)

Separate future **Reviewer/posting** status (`not started → processing → ready for review → published`) for AI summary / audio / export / client publish. Independent of `feedState`. **`ended` does not imply anything about that pipeline.** Do not use the word **“published”** in the `feedState` / `isDraft` model — reserved for that later status.

### Phase 5 gating (sharper)

Attendee PWA + Output view gate on **`feedState` alone** per the table above:

- Captions only when `feedState` is `live` **or** `stopping`
- Standby card when `standby` **or** `testing`
- Never gate on “chunks exist”

---

## 3. Conflicts with what exists today (flag, don’t silently reconcile)

### 3.1 Types — `types/index.ts`

| Today | Required |
| --- | --- |
| No `isDraft` on `SessionDoc` | Add `isDraft: boolean` |
| `FeedState = 'standby' \| 'live' \| 'paused' \| 'ended'` | Become `'standby' \| 'testing' \| 'live' \| 'stopping' \| 'ended'`; **remove `paused`** |
| `LifecycleStatus` = `preproduction \| ready \| live \| stopping \| ended \| underReview \| approved \| published` | **Still present and widely used** — conflicts with the new dual-axis model as the live machine |

**Open decision (needs input):** What happens to `lifecycleStatus`?

- **Option A (recommended for Slice 2B):** Stop using `lifecycleStatus` for the live capture machine. Drive Tech/Attendee/Admin *session room* badges from `isDraft` + `feedState` only. Leave `lifecycleStatus` in place temporarily for existing review helpers (`summarize.ts` → `underReview`, etc.) but treat it as **legacy / future Reviewer pipeline debt** — do not write `live`/`stopping`/`ended` into it from start/stop/go-live anymore once migrated.
- **Option B:** Delete/rename `lifecycleStatus` in the same pass (larger blast radius: Admin UI, CF, indexes, scripts).
- **Do not** keep writing both axes as if they were the same machine (that is today’s bug).

### 3.2 Create session — `CreateSessionModal.tsx`

Today writes:

```ts
lifecycleStatus: 'preproduction',
feedState: 'standby',
```

**Conflict:** No `isDraft`. New creates should be `isDraft: true` (admin-private) + `feedState: 'standby'`, and must not rely on `preproduction` as the draft signal.

### 3.3 Unlock / session lists

| Location | Conflict |
| --- | --- |
| `unlockShowByCredential` / `POST /api/tech/unlock` | Returns **all** sessions; no `isDraft` filter |
| Electron session picker | Will show drafts unless filtered |
| `app/tech/page.tsx` | Lists by schedule + `lifecycleStatus`/`paused` “liveish” heuristics — wrong axes |

**Required:** Tech unlock + web tech lists return only `isDraft === false`.

### 3.4 `startSession` — `lib/tech/sessionLifecycle.ts` + `/api/tech/sessions/start`

Today:

- Rejects if `lifecycleStatus === 'live'` **or** `feedState === 'live'`
- Writes **both** `lifecycleStatus: 'live'` and `feedState: 'live'`
- RTDB `liveSessions/{id}` set with `feedState: 'live'`
- Audit action `SESSION_FEED_GO_LIVE` on start (misnamed for test start)

**Required:**

- Start test: `feedState → testing` (Firestore + RTDB); **do not** set feed to `live`
- Reject if already `testing` / `live` / `stopping` (on **feedState**)
- Stop conflating with `lifecycleStatus === 'live'`
- Rename/repurpose audit metadata so start ≠ Go Live
- Recall `startRecording()` still real (unchanged intent)

### 3.5 Go Live

| Today | Required |
| --- | --- |
| Web `GoLiveControl` can set feed to `standby` / `live` / `ended` from client Auth | Electron needs **Go Live = feedState `testing` → `live` only**; no Recall restart |
| No dedicated API | Add `POST /api/tech/sessions/go-live` (credential-gated Admin write) for Electron; update or replace web control |
| Buttons allow `standby` after live and direct `ended` | Conflicts with one-way machine + End→`stopping` |

### 3.6 End / stop — `stopSession` + Electron stop

Today:

- Firestore: `lifecycleStatus: 'stopping'`, `feedState: 'paused'`
- RTDB: `feedState: 'paused'`
- `ended` later via webhook → `markSessionEndedFromRecall`

**Conflicts:**

- `paused` is not in the new machine — must become **`feedState: 'stopping'`** immediately on End
- Optimistic UI: flip to Stopping on click without waiting for Recall webhook (API write should also be immediate; SDK stop can follow)
- `ended` still webhook-confirmed — OK and aligned
- Attendee must treat `stopping` like `live` (Phase 5; document only here)

### 3.7 `onSessionEnd` CF + `markSessionEndedFromRecall`

Still set `lifecycleStatus: 'ended'` + `feedState: 'ended'`. Feed `ended` is correct. Lifecycle write is legacy-axis coupling — flag under the lifecycleStatus decision above. CF also **deletes** the entire `liveSessions/{sessionId}` node on ended — operator preview / attendee buffer during `stopping` must finish before that; today deletion is on `ended`, which is fine if `stopping` keeps chunks readable.

### 3.8 UIs already rendering old fields

| UI | What it shows | Conflict |
| --- | --- | --- |
| Electron `App.jsx` | `LifecycleBadge` on `lifecycleStatus` + separate “Recording” capture badge; optional `Feed: {feedState}` | Must become **tech feedState labels only** (+ session identity), not lifecycle |
| `app/tech/page.tsx` / session detail | `feed:` badge + `lifecycleStatus` muted | Wrong vocabulary (`paused`, lifecycle) |
| `GoLiveControl.tsx` | standby / go live / end feed | Wrong transitions |
| `ShowDetail.tsx` Admin | badges from `lifecycleStatus` + muted `feedState` | Must move to Draft/Ready/Testing/Live/Stopping/Ended per table |
| `PrivateTranscriptPreview.tsx` | RTDB chunks, not feed-gated | **Correct for operator**; keep ungated on feed for tech preview |
| Scripts (`verify-recall-audio-store-local.ts`) | expects `paused` + lifecycle stopping/ended | Update when APIs change |

### 3.9 Firestore rules / indexes

- Tech may update sessions only if affected keys are **`['feedState']`** — still correct for Go Live; `isDraft` remains admin/editor-only (good).
- `firestore.indexes.json` indexes `lifecycleStatus` — leave until Reviewer phase; don’t build new live queries on it.

### 3.10 Word “published”

`LifecycleStatus` includes `'published'` today; Admin/review copy may say it. New feed/`isDraft` model must not. Future Reviewer status owns that word.

---

## 4. Rest of Slice 2B (Electron operator panel)

### 4.1 Audio input meter

- Continuous `getUserMedia` + `AnalyserNode` from app-open (reuse `renderer-src/lib/inputMeterTap.js`)
- Guardrails: `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`
- UI: single 0–100 horizontal bar
- Independent of session selection and `feedState`
- Mac concurrency still being validated separately; ship guardrails regardless

### 4.2 Audio output

- Default `audiooutput` label via `enumerateDevices` + `devicechange`
- “Play test tone” button (Web Audio oscillator; `setSinkId` when available)
- No passive output level meter

### 4.3 Device / network switching

- No in-app pickers
- IPC → `shell.openExternal` to OS Sound and Network settings (macOS + Windows URLs)
- Warn if recording active: Recall binds default devices at start; mid-session OS changes can kill capture

### 4.4 Network health

**Signal:** Electron already records `lastWebhookRttMs` + `lastWebhookOkAt` on each transcript forward (`main.js`). No production Mac histogram checked into the repo; `SPIKE_REPORT.md` only estimates “low hundreds of ms to a few seconds.” Web tech monitor treats Firebase probe &lt; **1500 ms** as OK.

**Proposed defaults (sanity-check on event Wi‑Fi later):**

| Color | When recording/testing (webhook expected) | When idle (no forwards yet) |
| --- | --- | --- |
| **Green** | Last OK &lt; 20s ago **and** RTT ≤ **500 ms** | `navigator.onLine` + (optional) RTDB `.info/connected` |
| **Yellow** | Last OK &lt; 20s and RTT **501–1500 ms**, **or** last OK 20–45s ago | Online but RTDB disconnected / flaky |
| **Red** | Offline, forward failures, RTT &gt; **1500 ms**, or last OK &gt; 45s while `testing`/`live`/`stopping` | Offline |

Also show connected network name (SSID or “Wired / unknown”) via main-process OS helpers. Deep-link to OS network settings — no Wi‑Fi picker.

**Needs input:** Approve or tweak these thresholds after one real on-site sample.

### 4.5 Live caption preview

- Subscribe to `liveSessions/{sessionId}/chunks` with Firebase client SDK (see §1 — **public read, no Auth**)
- Visible in **testing and live** (and optionally stopping, while session still selected)
- Not gated on `feedState === 'live'`
- Needs `NEXT_PUBLIC_FIREBASE_*` (at least `databaseURL`, `apiKey`, `projectId`) available to the Electron renderer build — today Electron only talks HTTP to Next

### 4.6 Status badges + session identity

- Tech labels from §2 table only (`Standby` / `Testing` / `Live` / `Stopping` / `Ended`)
- Show session identity (friendly name / room) alongside — **not** a second status axis
- Remove lifecycle-based badges from the operator record screen

### 4.7 Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header (centered band): brand · show · session picker      │
├──────────────────────────────┬─────────────────────────────┤
│ Live caption preview (16:9)  │ Input meter 0–100           │
│ ~2/3 width                   │ Output name + test tone     │
│                              │ Network R/Y/G + name        │
│                              │ Feed label + session id     │
├──────────────────────────────┴─────────────────────────────┤
│ End session                                                │
└────────────────────────────────────────────────────────────┘
```

Page content centered. CTAs: Start test / Go Live by state; End below grid.

### 4.8 Operator action → feedState (Electron)

| Operator action | Recall | feedState |
| --- | --- | --- |
| Start test capture | `startRecording()` | → `testing` |
| Go Live | none | → `live` |
| End session | `stopRecording()` after/with immediate state write | → `stopping` immediately; → `ended` on confirm |

---

## 5. Suggested implementation order (after plan sign-off)

1. Types: `isDraft` + new `FeedState`; decide `lifecycleStatus` freeze vs migrate (§3.1)
2. Create session + Admin draft toggle + unlock/list filters
3. Rewrite `startSession` / add `go-live` / rewrite `stopSession` (`paused` → `stopping`)
4. Electron: Firebase client for caption preview; meter/output/OS settings/network
5. Electron layout + badges + actions wired to new APIs
6. Align web tech/Admin badges enough that they don’t lie (minimum: stop showing `paused` / false Go Live)
7. Mac hardware pass on full screen; Windows network/sound deep-links later

---

## 6. Explicit non-goals

- Full Attendee PWA / Output view (Phase 5) — document gating only
- Reviewer/posting pipeline status
- In-app device/Wi‑Fi pickers; output level meters
- Stop-test / reset / multi-take restart
- Implementing production Slice 2B UI in this documentation pass

---

## 7. Decisions still needed from you

1. **`lifecycleStatus` disposition** — Option A (freeze / stop writing for live machine) vs Option B (remove in-band)?  
2. **Default for new sessions** — `isDraft: true` until admin “publishes visibility,” or create already visible?  
3. **Admin control for `isDraft`** — explicit “Make visible to tech” toggle on Show detail?  
4. **Network R/Y/G thresholds** — accept §4.4 proposal pending on-site tweak?  
5. **Web Tech panel in this slice** — update in parallel, or Electron-first and leave web controls clearly broken/legacy until a follow-up?  
6. **macOS version** for Sound/Network Settings deep-link URLs on operator laptops?
