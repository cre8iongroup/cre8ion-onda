# Slice 2B — Implementation plan (final, authoritative)

**Product:** **Onda Operator** (permanent name — UI copy, window titles, comments).  
**Status:** Implementation in progress on this branch (plan signed off + addenda).  
**Addenda:** GoLiveControl outdated banner; ended caption empty-state; optimistic Stopping rollback to `live` with persistent error; Firebase client env documented in PR / `.env.example`.

### Scope boundaries

| In | Out |
| --- | --- |
| Electron Onda Operator Slice 2B UI + APIs | `/tech/login` — **completely untouched** |
| Phase 3 Admin: ShowDetail badges, CreateSession, isDraft toggle | Redesign of holdover web tech surface |
| Delete `lifecycleStatus` everywhere it blocks the new model | Attendee PWA / Output (Phase 5) — gating rules documented only |
| Minimal `app/tech/*` (non-login) field-swaps so the build compiles | Reviewer/posting pipeline status; migration script |

---

## 1. State model

### `isDraft: boolean` (admin-only)

| Rule | Detail |
| --- | --- |
| Default on create | `true` |
| `true` | Session does not appear in Onda Operator picker or Attendee PWA |
| `false` | Visible; does not imply feed progress (`feedState` starts `standby`) |
| Reversible | Admin may show ↔ hide |
| **Hide blocked when** | `feedState ∈ { testing, live, stopping }` — show clear reason, e.g. “End the session before hiding it.” Hide allowed only at `standby` or `ended`. |
| Who writes | Admin/Editor only |
| Operator / Attendee | Never read/write for controls — lists simply omit drafts |

### `feedState` (single machine; all UIs format it)

```
standby → testing → live → stopping → ended
```

One-way. No return from `testing` → `standby`. No reset / stop-test.

| Value | Meaning |
| --- | --- |
| `standby` | Visible (`isDraft=false`), no Recall recording |
| `testing` | Real `startRecording()`; audio/transcript to cloud. **UI label in Operator: “Sound check”** — enum stays `testing` |
| `live` | Visibility flip only; same continuous Recall take (only reachable from `testing`) |
| `stopping` | Immediate on End (optimistic + API); before webhook |
| `ended` | Webhook / upload-complete confirmation |

**Delete entirely:** `lifecycleStatus` / `LifecycleStatus` / feed value `paused`.  
Do not use “published” in this model (reserved for future Reviewer pipeline). `ended` implies nothing about that pipeline.

### Per-UI labels (format only — no parallel stored status)

| Condition | Onda Operator | Attendee PWA | Admin/Editor |
| --- | --- | --- | --- |
| `isDraft=true` | not in picker | doesn’t exist | **Draft** |
| `standby` | Standby | “[Title] starts at [Time] in [Room]” + QR/link | **Ready** |
| `testing` | **Sound check** | identical to standby | **Testing** |
| `live` | Live | live captions | **Live** |
| `stopping` | Stopping | **identical to live** (no visible change) | **Stopping** (distinct) |
| `ended` | Ended | thank-you + closing branding | **Ended** |

### Phase 5 gating (document — do not build)

Attendee PWA + Output gate on **`feedState` alone**:

- Captions: `live` **or** `stopping`
- Info card: `standby` **or** `testing`
- Never gate on data presence (test chunks flow during `testing`)

---

## 2. Button UX (Onda Operator) — below the 2×2 grid

Two elements, **not** a toggle. Sound check is **required** before Go Live.

### A. Secondary — “Enable sound check”

| `feedState` | UI |
| --- | --- |
| `standby` | Secondary button **Enable sound check** — clickable |
| On click | Real Recall start + API `feedState → testing` |
| `testing` / after use | Button **replaced** (not disabled) by status chip **“Sound check active”** — no leftover button implying undo |
| `live` / `stopping` / `ended` | Chip or equivalent non-button status as needed; no re-enable |

### B. Primary — “Go Live” → “End session”

| `feedState` | UI |
| --- | --- |
| `standby` | Primary **Go Live** visible but **disabled**; hover tooltip: **“Run sound check first.”** |
| `testing` | **Go Live** enabled |
| On Go Live click | API `feedState → live` only — **no** Recall restart |
| `live` | Same control relabels to **End session** |
| On End click | Optimistic + API `→ stopping`, then Recall stop; webhook → `ended` |
| `stopping` / `ended` | End control disabled / completed state |

**Not allowed:** Go Live from `standby` (enforced by disabled + tooltip + server reject if somehow called).

---

## 3. Delete `lifecycleStatus` — conflict inventory

### 3.1 Types — `types/index.ts`

- Remove `LifecycleStatus` and `SessionDoc.lifecycleStatus`
- Add `isDraft: boolean`
- `FeedState = 'standby' | 'testing' | 'live' | 'stopping' | 'ended'`
- Shared label helper: `sessionStatusLabel(session, 'operator' | 'admin')` (Attendee deferred to Phase 5)

### 3.2 Server — `lib/tech/sessionLifecycle.ts` + API routes

| Today (conflict) | After |
| --- | --- |
| `SessionSummary.lifecycleStatus` | `isDraft` + `feedState` |
| Unlock returns all sessions | Filter **`isDraft === false`** |
| `startSession` sets lifecycle+feed `live`; audit `SESSION_FEED_GO_LIVE` | **Sound check start:** `feedState → testing`; require `isDraft===false` and current `standby`; reject if already `testing\|live\|stopping`; new/repurposed audit (not Go Live) |
| No go-live API | **`POST /api/tech/sessions/go-live`:** only `testing → live` |
| `stopSession` → lifecycle `stopping`, feed `paused` | `feedState → stopping` (FS + RTDB); drop lifecycle / `paused` |
| `markSessionEndedFromRecall` sets both ended | `feedState → ended` only |
| Rejects on `underReview\|approved\|published` lifecycle | Drop those checks (field gone); gate on `feedState` + `isDraft` only |

### 3.3 Cloud Functions

| File | Change |
| --- | --- |
| `onSessionEnd.ts` | Write `feedState: 'ended'` only; remove lifecycle write |
| `summarize.ts` | Remove `lifecycleStatus: 'underReview'` write; TODO for future Reviewer status field — do not invent replacement enum here |

### 3.4 Indexes — `firestore.indexes.json`

- Remove `lifecycleStatus` + `scheduledStart` composite
- Keep/add `feedState` + `scheduledStart`; add `isDraft` + `scheduledStart` if Admin queries need it

### 3.5 Scripts

- `scripts/verify-recall-audio-store-local.ts` — assert new feed values (`stopping` not `paused`); drop lifecycle asserts

### 3.6 Data — **no migration script**

No real production data. Delete/recreate the few ALPFA test session docs with `isDraft` + `feedState` manually. Do not map old `lifecycleStatus` forward.

---

## 4. Phase 3 Admin Panel (in scope)

### 4.1 `ShowDetail.tsx`

- Replace dual badges (`lifecycleStatus` + muted `feedState`) with **one** Admin label: Draft / Ready / Testing / Live / Stopping / Ended
- Style Stopping distinctly (operational alarm if stuck)

### 4.2 `CreateSessionModal.tsx`

- Write `isDraft: true`, `feedState: 'standby'`
- Remove `preproduction` / any `lifecycleStatus`

### 4.3 Make visible / Hide control

- Reversible `isDraft` toggle on session row/detail
- **Block** hide when `feedState ∈ { testing, live, stopping }` with explicit message (“End the session before hiding it.”)
- Allow hide at `standby` or `ended`; allow make-visible anytime `isDraft===true`

### 4.4 Firestore rules

- Tech updates remain `feedState`-only
- Admin/editor full session update covers `isDraft` (already)
- No references to `lifecycleStatus`

---

## 5. Holdover `app/tech/*` (non-login)

| File | Action |
| --- | --- |
| `/tech/login` | **Do not touch** |
| `page.tsx`, `sessions/[sessionId]/page.tsx` | Minimal: stop reading `lifecycleStatus` / `paused`; badge off `feedState` (+ ignore drafts if trivial) — **no redesign** |
| `GoLiveControl.tsx` | Minimal compile fix only (types will break on `paused` / old transitions). Do **not** rebuild web sound-check UX here — that belongs to Onda Operator / later admin-config surface |
| Other tech components | Field-swap only if TS requires |

---

## 6. Rest of Slice 2B — Onda Operator UI

### 6.1 Naming

Window title, `index.html`, welcome/header, comments: **Onda Operator**. Strip “Tech Operator Panel” / “Onda Tech Operator” in touched Electron files.

### 6.2 Audio input meter

- Continuous getUserMedia + AnalyserNode from app-open (`inputMeterTap.js`)
- DSP guardrails on this tap: `echoCancellation` / noiseSuppression / AGC **false**
- Simple 0–100 horizontal bar; independent of session + `feedState`

### 6.3 Audio output

- Default `audiooutput` name via `enumerateDevices` + `devicechange`
- Play test tone button
- No passive output level meter

### 6.4 Device / network switching

- No in-app pickers
- Deep-link OS Sound + Network settings via main-process `shell.openExternal`
- **Target macOS Tahoe (26.x)** — current `x-apple.systempreferences:` URI scheme; no pre-Ventura branching
- Windows: `ms-settings:sound` / `ms-settings:network` when that laptop is in hand
- Warn while capturing: Recall binds defaults at start; OS device change can kill capture

### 6.5 Network health

- Metric: `lastWebhookRttMs` + staleness (`lastWebhookOkAt`)
- **Single tunable config object** (easy retune without hunting magic numbers), e.g.:

```text
{ greenRttMsMax: 500, yellowRttMsMax: 1500, staleWhileCapturingMs: 45_000 }
```

- Green / Yellow / Red per provisional rules; idle (no webhooks yet) uses online/RTDB connectivity, not false red
- Show network name (SSID or Wired/unknown) beside indicator

### 6.6 Live caption preview

- Firebase client SDK + `databaseURL` in renderer
- Subscribe to `liveSessions/{sessionId}/chunks` (public `.read: true` — **no new auth**)
- Visible during sound check (`testing`) and `live` (and `stopping` while session selected)
- Go Live / End **writes** stay on credential-gated APIs — do not loosen RTDB write rules

### 6.7 Layout (centered, per mockup)

```
┌────────────────────────────────────────────────────────────┐
│ Header: Onda Operator · show · session picker              │
├──────────────────────────────┬─────────────────────────────┤
│ Live caption preview (16:9)  │ Input meter 0–100           │
│ ~2/3 width                   │ Output name + test tone     │
│                              │ Network R/Y/G + name        │
│                              │ Status: Sound check / …     │
├──────────────────────────────┴─────────────────────────────┤
│ Enable sound check | chip  ·  Go Live / End session          │
└────────────────────────────────────────────────────────────┘
```

Controls **below** the grid (not in the 2×2 cells).

### 6.8 Operator action summary

| UI action | Recall | `feedState` |
| --- | --- | --- |
| Enable sound check | `startRecording()` | → `testing` |
| Go Live | none | → `live` |
| End session | `stopRecording()` (after/with immediate state write) | → `stopping` then → `ended` |

---

## 7. Suggested build order (after sign-off)

1. Types + label helper; Firestore index update; manually recreate ALPFA test sessions  
2. Rewrite start (sound check) / add go-live / rewrite stop / ended; CF updates  
3. Admin: CreateSession, ShowDetail badge, isDraft toggle with block rule  
4. Minimal `app/tech/*` compile field-swaps  
5. Electron: naming, Firebase caption subscribe, meter/output/network/OS links, button UX, layout  
6. Staging pass: draft hide block while live, sound check → Go Live → End → ended  

---

## 8. Remaining open risks / conflicts not fully closed

1. **`GoLiveControl` on web tech** will remain semantically wrong (standby/end toggles) after a minimal type fix — acceptable per “no redesign,” but Admin/ops should not use it for real shows until that surface is replaced.  
2. **Optimistic Stopping vs API failure:** UI shows Stopping immediately; if `stopSession` API fails, need a clear error + possible rollback of optimistic state — specify in implementation.  
3. **Recall already recording + double sound check:** Server must reject start unless `standby`; Electron must not show Enable sound check after chip replace.  
4. **Firebase client env in Electron:** Renderer needs `NEXT_PUBLIC_FIREBASE_*` (or mirrored Electron env) for RTDB — today Electron only has HTTP to Next; wire carefully without shipping Admin secrets.  
5. **`onSessionEnd` deletes RTDB node on `ended`:** Fine for stopping buffer; ensure Operator doesn’t assume chunks persist after ended.  
6. **Windows** deep-links + concurrency still an open validation gap (non-blocking).  
7. **Mac concurrency paste-back** still required before “hardware verified” on the meter (non-blocking for coding after plan sign-off).  
8. **Audit log enum** `SESSION_FEED_GO_LIVE` today fires on start — rename/split so sound check ≠ Go Live in audit history.

No further product vocabulary decisions outstanding for this slice beyond sign-off of this document.
