# Slice 2B — Implementation plan (final, authoritative)

**Product name:** **Onda Operator** (permanent). Use in all new UI copy, window titles, and comments. Do not introduce “Tech Operator Panel”; update that string wherever a touched file still says it.

**Status:** Plan only — no implementation code in this pass.  
**Out of scope / do not touch:** Web tech login (`/tech/login`, `tech+{slug}@onda.tech` Auth flow) and the future redesign of that surface. Leave exactly as-is.

**Prior notes:** Step 0 concurrency spike + RTDB public-read confirmation remain valid (`AUDIO_CONCURRENCY_SPIKE.md`, §1 of earlier plans). Mac hardware overlap still runs separately; meter DSP guardrails ship either way.

---

## 1. State model (confirmed)

### Axis A — `isDraft: boolean` (admin-only, reversible)

| Rule | Detail |
| --- | --- |
| Default on create | `true` |
| `true` | Session **absent** from Onda Operator picker and Attendee PWA |
| `false` | Visible to tech + attendees; does **not** imply feed progress |
| Reversible | Admin may flip false→true and true→false at any time (e.g. hide a cancelled session) |
| Who writes | Admin/Editor only (Firestore rules already restrict tech updates to `feedState`) |
| Who reads for UX | Admin UI only for control; Operator/Attendee filter it out of lists — they never show a Draft control |

### Axis B — `feedState` (single machine; all UIs format it)

```
standby → testing → live → stopping → ended
```

| Value | Meaning |
| --- | --- |
| `standby` | `isDraft=false`, not capturing |
| `testing` | Real Recall `startRecording()`; audio/transcript to cloud |
| `live` | Visibility flip only — **same continuous take**, no Recall restart |
| `stopping` | End click → leave `live` **immediately** (optimistic + API); short handshake |
| `ended` | Stop confirmed via existing webhook / upload-complete path |

No reset / stop-test. Dead air between test and Go Live accepted.

**Remove entirely:** `lifecycleStatus` / `LifecycleStatus` / `paused` (as a feed value).  
**Do not** use the word “published” in this model — reserved for a future Reviewer/posting pipeline (out of scope). `feedState=ended` implies nothing about that pipeline.

### Per-UI labels (format only — never store parallel status fields)

| Condition | Onda Operator | Attendee PWA | Admin/Editor |
| --- | --- | --- | --- |
| `isDraft=true` | not in picker | session doesn’t exist | **Draft** |
| `standby` | Standby | “[Title] starts at [Time] in [Room]” + QR/link | **Ready** |
| `testing` | Testing | **identical to standby** | **Testing** |
| `live` | Live | live captions | **Live** |
| `stopping` | Stopping | **identical to live** (no visible change) | **Stopping** (distinct on purpose) |
| `ended` | Ended | thank-you + closing branding | **Ended** |

### Phase 5 gating (document only — not built here)

Attendee PWA + Output gate on **`feedState` alone** per the table:

- Captions when `live` **or** `stopping`
- Info card when `standby` **or** `testing`
- Never gate on “transcript/audio data exists” (test noise would leak during `testing`)

---

## 2. Full `lifecycleStatus` removal / migration

### 2.1 Types (`types/index.ts`)

- Delete `LifecycleStatus` type and `SessionDoc.lifecycleStatus`
- Add `isDraft: boolean`
- Replace `FeedState` with `'standby' | 'testing' | 'live' | 'stopping' | 'ended'` (drop `paused`)
- Update `RTDBSession.feedState` accordingly
- Shared label helpers (recommended): one pure function module used by Admin + Electron, e.g. `sessionStatusLabel({ isDraft, feedState }, 'admin' | 'operator')` — Attendee helpers deferred to Phase 5 but same table

### 2.2 Server / Electron APIs (`lib/tech/sessionLifecycle.ts` + routes)

| Function / route | Today | After |
| --- | --- | --- |
| `SessionSummary` | includes `lifecycleStatus` | `isDraft` + `feedState` only |
| `unlockShowByCredential` | returns all sessions | **Filter `isDraft === false`** for Operator |
| `startSession` | sets lifecycle+feed `live`; rejects on lifecycle | `feedState → testing` (FS + RTDB); reject if feed in `testing\|live\|stopping`; require `isDraft===false`; stop writing lifecycle; fix audit metadata (not “GO_LIVE”) |
| **New** `goLiveSession` + `POST /api/tech/sessions/go-live` | missing | `testing → live` only; no Recall; credential-gated |
| `stopSession` | lifecycle `stopping`, feed `paused` | `feedState → stopping` immediately (FS + RTDB); no lifecycle |
| `markSessionEndedFromRecall` | sets both ended | `feedState → ended` only; drop lifecycle write |

Electron `main.js`: track/send `feedState` (not lifecycle); Start test / Go Live / End map to the three APIs; optimistic UI → Stopping on End before webhook.

### 2.3 Cloud Functions

| File | Change |
| --- | --- |
| `functions/src/onSessionEnd.ts` | On feed `ended`: set Firestore `feedState: 'ended'` only; **remove** `lifecycleStatus: 'ended'`. Keep chunk migrate + RTDB node delete behavior (deletion after `ended` is fine — `stopping` still has chunks). |
| `functions/src/summarize.ts` | Today advances `lifecycleStatus → underReview`. **Remove that write.** Leave an explicit TODO that the future Reviewer/posting status field owns this; do not invent a replacement enum in this slice. |

### 2.4 Scripts / verification

- `scripts/verify-recall-audio-store-local.ts` — stop asserting `lifecycleStatus`; expect `feedState` `stopping`→`ended` (not `paused`)
- Any other script/doc referencing lifecycle — update when touched

### 2.5 Firestore indexes (`firestore.indexes.json`)

- **Remove** composite index on `lifecycleStatus` + `scheduledStart`
- Keep / add indexes as needed for Admin queries: e.g. `isDraft` + `scheduledStart`, existing `feedState` + `scheduledStart`
- Deploy index changes with the slice (or before ship)

### 2.6 Firestore rules

- Tech may still update only `feedState` (unchanged intent)
- Ensure admin/editor can update `isDraft` (already covered by full session update for admin/editor)
- No rule should reference `lifecycleStatus`

### 2.7 Existing Firestore documents (migration)

One-time backfill (script or Admin-assisted), **required** before relying on Operator filters:

| Legacy `lifecycleStatus` | Proposed `isDraft` | Proposed `feedState` |
| --- | --- | --- |
| `preproduction` | `true` | `standby` |
| `ready` | `false` | `standby` |
| `live` | `false` | Prefer existing `feedState` if `live`/`paused`; else `live` (manual check if feed was `standby` while lifecycle live — data oddity) |
| `stopping` | `false` | `stopping` (map legacy feed `paused` → `stopping`) |
| `ended` / `underReview` / `approved` / `published` | `false` | `ended` |
| missing field | `true` | `standby` |

Then **delete** `lifecycleStatus` from documents (or leave orphan field unread — prefer delete in same script for cleanliness).

**Risk:** Mis-mapped live rooms during migration. Run against staging first; for any session with `lifecycleStatus=live`, confirm with ops before auto-map.

---

## 3. Phase 3 Admin Panel — in-scope touch list

These are **real Slice 2B work**, not a fast-follow.

### 3.1 `app/admin/shows/[showId]/ShowDetail.tsx`

**Today:** Dual badges — primary `lifecycleStatus` via `statusBadgeClass()`, muted raw `feedState`.

**Required:**

- Replace with **one** admin label from the table (`Draft` / `Ready` / `Testing` / `Live` / `Stopping` / `Ended`)
- Badge styling keyed off `isDraft` + `feedState` (Stopping distinct/warning; Live = live; Draft muted; Ready info; etc.)
- Delete `statusBadgeClass(lifecycleStatus)`

### 3.2 `app/admin/shows/[showId]/CreateSessionModal.tsx`

**Today:** `lifecycleStatus: 'preproduction', feedState: 'standby'`.

**Required:** `isDraft: true`, `feedState: 'standby'`; no lifecycle field.

### 3.3 Admin `isDraft` toggle (new control)

- On session row or detail in Show Detail: **Make visible** / **Hide from tech & attendees** (reversible)
- Writes `isDraft` only (admin/editor)
- Confirm copy: hiding does not delete; does not reset `feedState`
- **Open risk:** Hiding (`isDraft=true`) while `feedState` is `testing`/`live`/`stopping` — Operator loses the session mid-capture. Recommend either (a) disable hide while feed ∈ {testing, live, stopping}, or (b) allow with a strong confirm. **Needs your pick before build.**

### 3.4 Other Admin files

| File | Action |
| --- | --- |
| `CreateShowModal.tsx` | No lifecycle; optional copy tweak “tech operators” → “Onda Operator” only if we touch the field help text |
| `TechCredentialPanel.tsx` | No lifecycle; leave behavior; rename strings only if touched |
| `ShowsDashboard.tsx` / layouts / users | No session lifecycle badges today — no change unless a reference appears |

No separate session detail route under Admin today — list-on-show is the surface.

---

## 4. Onda Operator (Electron) — Slice 2B UI

### 4.1 Naming

- Window title, `index.html` `<title>`, welcome/header, comments: **Onda Operator**
- Update touched files that still say “Tech Operator” / “Onda Tech Operator”

### 4.2 Session picker

- Header; options from unlock payload (**already `isDraft=false` only**)
- Labels: session name + operator feed label (Standby/Testing/…)

### 4.3 Actions

| Control | Behavior |
| --- | --- |
| Start test capture | API → `testing` + Recall `startRecording()` |
| Go Live | API → `live` only |
| End session | Optimistic `stopping` + API `stopping` + Recall stop; webhook → `ended` |

### 4.4 Audio input meter

- App-open continuous getUserMedia + AnalyserNode (`inputMeterTap.js`)
- DSP guardrails: echoCancellation / noiseSuppression / autoGainControl **false**
- Simple 0–100 bar; independent of session / feedState

### 4.5 Audio output

- Default output device name (`enumerateDevices`)
- Play test tone; no passive output meter

### 4.6 OS settings deep-links

- Sound + Network via main-process `shell.openExternal` (macOS + Windows)
- No in-app device/Wi‑Fi pickers
- Warn when capturing: Recall binds defaults at start; OS device changes can kill capture

### 4.7 Network health

- Metric: `lastWebhookRttMs` (+ staleness via `lastWebhookOkAt`) — RTT ms, not throughput
- **Tunable constants** in one module (e.g. `networkHealthThresholds.js`), not inline magic numbers:

```text
GREEN_RTT_MS_MAX = 500
YELLOW_RTT_MS_MAX = 1500
STALE_WHILE_CAPTURING_MS = 45_000
```

- Green / Yellow / Red per accepted provisional rules; retune on-site later by editing constants
- Show SSID / “Wired / unknown” beside indicator

### 4.8 Live caption preview

- Firebase client SDK → RTDB `liveSessions/{id}/chunks` (public read; **no new auth**)
- Visible during `testing` and `live` (and while `stopping` if session still selected)
- Writes stay credential-gated APIs

### 4.9 Layout (centered)

```
Header: brand “Onda Operator” · show · session picker
Left ~2/3: 16:9 live caption preview
Right 2×2: input meter | output + tone | network R/Y/G + name | feed label + session identity
Below grid: End session
```

---

## 5. Explicitly not in this slice

| Item | Notes |
| --- | --- |
| Web `/tech/login` + synthetic Auth UX redesign | Do not touch |
| Attendee PWA / Output view | Phase 5; gating rules documented above |
| Reviewer/posting status pipeline | Future; strip `underReview` lifecycle write only |
| Full redesign of `app/tech/*` session pages | Not the Electron product; see §6 risk |

---

## 6. Remaining open risks / decisions

1. **Hide-while-live policy** for `isDraft` toggle (§3.3) — block vs confirm.  
2. **`app/tech/page.tsx` + `sessions/[sessionId]` + `GoLiveControl`:** Type removal of `lifecycleStatus` / `paused` will break TypeScript there. Per “don’t touch web tech login,” recommend **minimal compile-safe field swaps only** (badges read `isDraft`/`feedState`) **without** redesigning that holdover surface — or temporarily `// @ts-expect-error` if you prefer zero UX edits. Confirm preference.  
3. **Data migration** of existing prod/staging sessions — who runs it, staging-first sign-off.  
4. **macOS version** for Sound/Network Settings URL schemes on operator laptops.  
5. **Mockup CTA placement** — Start test / Go Live exact position vs End-below-grid (mockup not in repo).  
6. **Mac concurrency paste-back** — non-blocking for plan; still required before calling meter “hardware verified.”  
7. **Windows** sound/network deep-links + concurrency — open validation gap.

---

## 7. Suggested build order (after plan sign-off)

1. Types + shared label helper; Firestore index update  
2. Migration script for existing sessions  
3. `sessionLifecycle` + start / go-live / stop / ended paths + CF updates  
4. Admin: CreateSession, ShowDetail badges, isDraft toggle  
5. Electron: rename strings, APIs, meter/output/network/OS links, RTDB preview, layout  
6. Minimal `app/tech/*` compile fixes if required (§6.2)  
7. Staging verify: draft hide/show, test→live→stopping→ended, Admin Stopping visibility, webhook ended  

---

## 8. Decision checklist for review meeting

- [ ] Approve hide-while-capturing policy for `isDraft`  
- [ ] Approve minimal vs zero edits on holdover `app/tech/*` (not login)  
- [ ] Approve migration mapping table (§2.7)  
- [ ] Confirm operator laptop macOS major version for deep-links  
- [ ] Confirm Start test / Go Live placement from approved mockup  
