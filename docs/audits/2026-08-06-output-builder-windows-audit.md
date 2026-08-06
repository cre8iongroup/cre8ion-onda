# Audit: Output Builder + Output Windows

**Status:** Audit / proposal only — no implementation in this pass.  
**Audience:** Alex + team (review before any implementation prompt)  
**Date:** 2026-08-06  
**Branch:** `cursor/audit-output-builder-windows-d621`  
**Scope:** What exists today around `outputLayouts`, Room documents, live caption RTDB, routing, Operator link-out — vs. the Output Builder / Output Windows spec. Explicitly flags the Create Layout `backgroundColor` bug.

---

## Verdict (short)

Almost none of the new model exists yet. What we have is a **global preset-shaped CRUD stub** (`outputLayouts` + `/admin/layouts`) that never binds to rooms at runtime, a typed-but-unused `SessionDoc.outputLayoutTemplateId`, and a working **session-scoped** caption pipeline (`liveSessions/{sessionId}`). The room-scoped Builder, `/output/{roomId}/{windowIndex}` Windows, Room.`outputConfig`, and `outputLive/{roomId}` are all greenfield. The Create Layout modal bug is real and independent of the redesign.

---

## 1. What exists today

### 1.1 Global `outputLayouts` collection + Admin UI (built, incomplete)

| Piece | Status | Location |
|---|---|---|
| Types | Built | `OutputLayoutDoc`, `FontSize`, `BackgroundType`, `CaptionLayout` in `types/index.ts` |
| Firestore rules | Built | `match /outputLayouts/{layoutId}` — signed-in read; admin/editor/tech create+update; admin/editor delete |
| Capability | Built | `canManageOutputLayouts` — true for admin, editor, **tech**; false for contributor/reviewer |
| Admin nav | Built | `/admin/layouts` in admin shell (`app/admin/layout.tsx`) |
| List page | Built | `LayoutsDashboard.tsx` — live `onSnapshot` list, create CTA, empty state |
| Create modal | Built (buggy) | `CreateLayoutModal.tsx` — Name, Primary/Secondary language, Caption layout, Font size, Background, Text color, Show speaker labels |
| Edit / delete UI | **Missing** | List is display-only; no detail route, no edit modal, no delete |
| Runtime consumers | **None** | No page, function, or Operator path reads an `outputLayouts` doc to render captions |

Schema today (`OutputLayoutDoc`):

```
name, primaryLanguage, secondaryLanguage?,
fontSize: 'small'|'medium'|'large'|'xlarge',
backgroundType: 'black'|'white'|'chromaKey'|'custom',
backgroundColor?: string,   // only meaningful when custom
layout: 'stacked'|'sideBySide',
textColor: string,
showSpeakerLabels: boolean,
createdBy, createdAt
```

This is a **single template** describing two languages + one shared font/background/layout — not a per-window array.

Introduced in PR #5 / commit `3f7de25` to kill a dead admin nav link. Copy still says “Templates for attendee captions and output feeds,” but neither attendee nor output actually uses it.

### 1.2 Explicit bug: Create Layout writes `backgroundColor: undefined`

In `CreateLayoutModal.tsx` `onSubmit`:

```ts
backgroundColor:
  values.backgroundType === 'custom' ? values.backgroundColor : undefined,
```

For Background = Black / White / Chroma key, the payload includes `backgroundColor: undefined`. Firestore `addDoc` rejects undefined field values — matching the reported error:

```
Function addDoc() called with invalid data. Unsupported field value: undefined
(found in field backgroundColor in document outputLayouts/…)
```

`bgPreview()` in the list already maps `black`/`white`/`chromaKey` → hex and only reads `backgroundColor` for `custom`. The write path should either **omit** the field for non-custom types, or always persist a resolved hex. **Fix regardless of the Builder redesign.**

Related: `secondaryLanguage: values.secondaryLanguage || undefined` has the same Firestore hazard if the optional secondary is cleared to `""` — currently the empty option yields `undefined` via `|| undefined`, so create with “None” also risks failure on that field. Worth fixing in the same pass.

### 1.3 Room documents — no output config

Canonical room: `shows/{showId}/rooms/{roomId}` (`RoomDoc`):

```
name, branding, qrCodeUrl?, createdAt, createdBy
```

- **No `outputConfig`.**
- **No `layoutId` / room→layout reference.**
- Admin Room edit (`RoomEditClient.tsx`) covers name + branding + QR only.
- `defaultRoomDocFields()` does not seed any output fields.
- Denormalized `ShowDoc.rooms[]` remains `{id, name}` for Operator unlock — no output fields there either (correct; keep output on the canonical room doc).

### 1.4 Session-level leftover: `outputLayoutTemplateId`

`SessionDoc` types an optional `outputLayoutTemplateId?: string`. Grep shows **zero reads or writes** outside the type definition. Session create (`CreateSessionModal`) does not set it. This is a typed stub of the old “point at a layout doc” idea — at session scope, not room. Spec kills the reference model; this field should be removed or left unused and never wired.

### 1.5 Live caption RTDB pipeline (built, session-scoped)

Canonical paths (`lib/rtdbPaths.ts` + `database.rules.json`):

```
liveSessions/{sessionId}/feedState     # public read; auth write
liveSessions/{sessionId}/chunks/...    # public read; server write only
recordingIndex/{recordingId}           # admin only
```

**No `outputLive/` (or any room-scoped config) path exists.**

Writers / readers today:

| Actor | Path usage |
|---|---|
| Recall webhook / CF | Write chunks under `liveSessions/{sessionId}/chunks` |
| `onTranscriptChunk` | Translations onto same chunks |
| `onSessionEnd` | On `feedState → ended`: flush → Firestore, then **delete entire** `liveSessions/{sessionId}` |
| Attendee `LiveCaptionFeed` | Subscribe `feedState` + chunks; **only subscribe chunks when `feedState === 'live'`** |
| Operator Electron preview | Subscribe chunks during `testing`/`live`/`stopping` (operator preview — intentionally not live-gated) |
| Tech web `PrivateTranscriptPreview` / `GoLiveControl` | Same session paths |

Reusable patterns: client `onValue` / `onChildAdded` via `getClientDatabase()`, dual-write Firestore + RTDB for `feedState` (`GoLiveControl`), path helpers in `lib/rtdbPaths.ts`. **None of this is room-config shaped** — piggybacking on `liveSessions/{sessionId}` for Builder↔Windows config would conflate ephemeral captions with persisted display config and would be wiped on session end. Spec’s separate `outputLive/{roomId}` is the right shape.

### 1.6 `feedState === 'live'` gating (built for Attendee; Output not built)

- Room public loader (`loadPublicRoomById`) already computes `liveSession = sessions.find(s => s.feedState === 'live')`.
- Attendee room page promotes that session; session caption page clears chunks unless live.
- Prior Phase 5 note (`electron-spike/SLICE_2B_AUDIT_AND_PLAN.md`): never gate attendee/output on “does transcript data exist” — testing also writes RTDB chunks. Spec aligns with this.
- **Output Windows do not exist yet**, so the gate is documented intent only for that surface.

### 1.7 Routing / scaffolding

| Route / surface | Status |
|---|---|
| `/admin/layouts` | Exists (preset CRUD stub) |
| Output Builder page | **Does not exist** |
| `/output/...` | **Does not exist** |
| `proxy.ts` | Comment already says “Attendee and **output views** are fully public” — anticipated, not implemented. `/output` is not under `PROTECTED_PREFIXES`, so it would be public by default once added. |
| Operator → Builder link | **Does not exist** |

Tech web panel (`/tech`) is marked outdated (“use Onda Operator”). No output builder under `/tech` either.

### 1.8 Onda Operator instructions area (built; no Output Builder link)

- `ShowDoc.operatorInstructions` markdown, unlocked via `/api/tech/unlock`, rendered in Electron as `OperatorInstructions`.
- Links in markdown open `target="_blank"`.
- Operator already has `selectedRoomId` / room picker.
- **No dedicated “Open Output Builder” control** and no `window.open` / popup helpers in the repo.
- Link-out is a small Electron addition: static or dynamic URL into the web Builder with `?roomId=` when a room is selected.

---

## 2. Gap vs. spec

| Spec item | Current state | Gap |
|---|---|---|
| Room.`outputConfig.windows[]` | Absent on `RoomDoc` | Add from scratch (types, defaults, Admin/Tech write paths, rules) |
| Kill Room→`layoutId` binding | Never implemented (session stub only) | Don’t implement; delete/ignore `outputLayoutTemplateId` |
| `outputLayouts` as preset library | Collection + create/list exist; schema is dual-lang template, not windows array | Demote conceptually; **reshape schema** if presets should pre-fill `windows[]` |
| RTDB `outputLive/{roomId}` | Absent | New path + `database.rules.json` + path helpers |
| Output Builder (room-scoped UI) | Absent | New authenticated page + room picker |
| Output Windows `/output/{roomId}/{windowIndex}` | Absent | New public page(s); controls-free caption display |
| Live sync Builder → Windows | Absent | Builder writes RTDB; Windows subscribe |
| Persist `outputConfig` on Room | Absent | Explicit save and/or debounced Firestore write |
| Gate Windows on room’s `feedState === 'live'` session | Pattern exists for Attendee | Reuse `loadPublicRoomById` / live-session resolution + RTDB chunk subscribe |
| Operator link-out | Instructions markdown only | Small Electron UI addition |
| 16:9 branded / in-window editing / position restore / multi-room | N/A | Explicit non-goals — do not build |

### Preset library fitness (question from the spec)

**Current CRUD does not match the `windows[]` shape.** Keeping it “as-is” as a preset library would force an awkward mapping at apply-time:

| Current field | Spec window field | Mapping friction |
|---|---|---|
| `primaryLanguage` + `secondaryLanguage?` | `windows[].language` | Map to 1–2 array entries — OK |
| Template-level `fontSize` enum | Per-window `fontSize: number` | Need px (or rem) scale; enum→number mapping is guesswork |
| `backgroundType` + optional `backgroundColor` | Per-window `backgroundColor` string | Resolve named types to hex once; matches the create bug |
| `layout: stacked \| sideBySide` | N/A (separate OS windows) | **Obsolete for this model** — two windows replace dual layout |
| `textColor`, `showSpeakerLabels` | Not in spec `windows[]` | Spec omits them; decide keep-on-window, drop, or defer |

**Recommendation:** reshape presets to store something close to `{ name, windows: OutputWindowConfig[] }` (plus optional future `presetKind` for the non-goal 16:9 style). Until then, either (a) ship Builder first-run defaults without presets, or (b) hardcode one “Two Window - Basic” seed and retire the mismatched modal fields (`layout`, dual language as template fields, etc.). Do not keep teaching Tech the stacked/side-by-side model if Windows are always separate URLs.

### Font size type conflict

- Layout types: enum `small|medium|large|xlarge`
- Spec: `fontSize: number`
- Attendee live captions: local `sm|md|lg` in localStorage (unrelated)

Implementing the spec as written means **number (px)** on `outputConfig` / `outputLive`, not the existing enum. Preset + Create Layout UI must change if retained.

---

## 3. Assumptions & conflicts to confirm before coding

1. **Builder auth home.** Spec says Tech configures; `canManageOutputLayouts` is already true for tech. Likely home: authenticated `/tech/output` or `/tech/output-builder` (show → room), not `/admin/layouts`. Admin may deep-link the same page. Confirm host path and whether contributor is excluded (yes under current caps).

2. **Who may write `Room.outputConfig`.** Today Firestore rules allow room create/update only for **admin/editor** assigned to the show. **Tech cannot update room docs.** Builder-as-Tech requires either:
   - rules change: tech may update only `outputConfig` (mirroring session `feedState`-only patch), or
   - Admin SDK API route gated on tech auth / show credential.
   Confirm which pattern (prefer rules-narrowed client write to match Go Live, unless credential-only Operator users lack Firebase user docs — Operator unlock uses show credential, not always a `/users/{uid}` tech role).

3. **Operator auth vs. web Builder.** Operator unlock is show-credential-based (Electron). Web Builder under `/tech` expects Firebase session cookie (`proxy.ts`). Tech Auth users (`tech+{slug}@onda.tech`) exist for `/tech/login`. Assumption: Operator link opens the **web** Builder; Tech signs into `/tech` separately (or already has a session). Link does not magically auth via credential.

4. **Sound check vs. Output Windows.** Spec: Windows show content only when a room session is `feedState === 'live'`; otherwise idle — not test data. That means **sound-check captions will not appear on Output Windows** (Operator’s own preview still will). Confirm this is intentional for switcher/OBS targets.

5. **How Output Windows discover the live session.** Reuse Attendee pattern: resolve room → find session with `feedState === 'live'` (Firestore), then subscribe to that session’s RTDB chunks. When live session changes mid-day, Windows must re-resolve (Firestore listener on sessions or poll). Room id in the URL is stable; session id is not.

6. **Room id uniqueness.** Public loaders scan published shows for `rooms/{roomId}`. Output URLs `/output/{roomId}/…` inherit that assumption. Fine if room ids are unique globally (they appear to be client-generated uniques today).

7. **`outputLive` write volume.** Continuous font-size slider → RTDB needs **debounce/throttle** (e.g. 50–100ms) in addition to debounced Firestore persist. Concern: unauthenticated public read of `outputLive` is fine for OBS machines; write must be auth-only. Slider spam from multiple Techs on one room is out of scope (spec: one room at a time) but rules shouldn’t assume single writer locking.

8. **Primary language default.** Spec: `windows[0]` defaults to show primary language. Codebase has `ShowDoc.defaultLanguages[]` (ordered list, English forced into attendee UI). Assumption: `defaultLanguages[0]` (typically `en`) is “primary.” Confirm.

9. **Unset language on window 2+.** Spec allows unset until Tech picks. RTDB/Firestore must allow `language: null` or omit field; Window with unset language shows idle/placeholder, not English fallback — confirm.

10. **Text color / speaker labels.** Spec’s `windows[]` omits `textColor` and `showSpeakerLabels`. Current layout modal has both. Assumption for v1 Output Windows: fixed text color (e.g. white on dark / black on light derived from background), no speaker labels (attendee already never shows diarization labels). Confirm drop vs. add to window config.

11. **Chroma key.** Spec says `backgroundColor: hex or named`. Preserving chroma green as a named or hex (`#00FF00`) option in Builder is likely still needed for switcher keying — confirm UI (swatches vs. free hex).

12. **Public Output Window data access.** Captions already public-read on RTDB when live. `outputLive` should be public-read similarly. Room `outputConfig` for first paint: either SSR via Admin SDK (like attendee loaders) or client read — **anonymous clients cannot read Firestore rooms** today (`canReadShow` requires auth). So Output Windows should **not** depend on client Firestore for config; prefer RTDB `outputLive` (+ optional public API / SSR seed). Builder (auth’d) reads Firestore `outputConfig` and hydrates RTDB on open if missing.

13. **`onSessionEnd` cleanup.** Deleting `liveSessions/{sessionId}` must not touch `outputLive/{roomId}` — separate trees avoid that class of bug.

14. **Naming.** Avoid “layout” / “panel” for the new surfaces. Rename admin nav “Layouts” → “Output Presets” (or similar) when presets are reshaped; keep collection id `outputLayouts` only if migration cost demands it (rename is nicer but optional).

---

## 4. Proposed implementation plan (for review — not started)

Ordered for dependency safety. Still **no code in this pass.**

### Phase A — Data model & rules

1. Extend `RoomDoc` with:
   ```ts
   outputConfig?: {
     windows: Array<{
       language: string | null
       fontSize: number
       backgroundColor: string
     }>
     updatedAt?: Timestamp
     updatedBy?: string
   }
   ```
2. Add RTDB types + `lib/rtdbPaths.ts` helpers for `outputLive/{roomId}` (mirror of live window config; optionally include `liveSessionId` cache — or keep session resolution on the Window via Firestore/SSR).
3. `database.rules.json`: `outputLive/$roomId` — `.read: true`, `.write: auth != null` (tighten later if needed).
4. Firestore rules: allow tech (or Builder role) to patch **only** `outputConfig` on room docs — or introduce Admin SDK route. Decide with assumption #2.
5. Leave `outputLayouts` in place; decide reshape vs. freeze in Phase D. Fix Create Layout `undefined` bug in a small independent commit if presets stay temporarily.

### Phase B — Output Windows (public display)

1. Route: `app/(output)/output/[roomId]/[windowIndex]/page.tsx` (or similar), **public**, minimal chrome, no controls, no hover UI.
2. Resolve live session under room (`feedState === 'live'`); idle/waiting UI otherwise.
3. Subscribe RTDB captions for that session; map language via existing `mapChunksForCaptionLanguage` / `buildCaptionDisplayLines`.
4. Subscribe `outputLive/{roomId}` (or window subpath) for font size / background / language; apply CSS live.
5. SSR/API seed so first paint isn’t blank before RTDB connects.

### Phase C — Output Builder (authenticated)

1. New Tech-scoped page: pick show (assigned) → pick room → edit `windows[]` (ALPFA UI shows exactly two; array underneath).
2. No in-Builder preview panel; buttons to **open** `/output/{roomId}/0` and `/1` (`window.open`).
3. On every control change: throttle-write `outputLive/{roomId}`; debounce-write Firestore `outputConfig`.
4. First-time room: if no `outputConfig`, seed `windows[0].language` from show `defaultLanguages[0]`, `windows[1].language = null`, sensible font/bg defaults — optionally from a preset apply step.
5. Support `?roomId=` (and maybe `?showId=`) deep link from Operator.

### Phase D — Preset library demotion

1. Reshape `OutputLayoutDoc` → preset with `windows[]` (or freeze old docs and add `OutputPresetDoc`).
2. Rewrite Create/List UI copy and fields; drop stacked/sideBySide for this product path.
3. “Apply preset” only on Builder first-run / explicit reset — never a live room→preset reference.
4. Fix `backgroundColor: undefined` write bug as part of this or as a hotfix beforehand.

### Phase E — Operator link-out

1. In Electron instructions / Input-Network area: “Open Output Builder” control.
2. URL = web origin + Builder path + `roomId=${selectedRoomId}` when set; else Builder root.
3. Open in system browser (`shell.openExternal` or `target=_blank`), not inside Electron BrowserView — so Tech can drag Builder independently of Operator.

### Explicit non-goals (unchanged)

- No 16:9 branded full-frame preset UI (schema may leave room via array / future `kind`).
- No editing inside Output Windows.
- No OS window position persistence.
- No multi-room Builder state.

---

## 5. Suggested review decisions (checklist)

Before an implementation prompt, please confirm:

- [ ] Builder lives under `/tech/...` (vs. admin-only)
- [ ] Tech write path for `outputConfig` (rules vs. API)
- [ ] Output Windows stay dark during `testing` (sound check)
- [ ] `fontSize` is numeric px; drop enum for this feature
- [ ] Drop `textColor` / `showSpeakerLabels` / stacked|sideBySide from v1 window config
- [ ] Preset library: reshape now vs. Builder defaults only + fix create bug later
- [ ] `outputLive` public read + auth write; debounce both RTDB and Firestore
- [ ] Operator opens Builder in external browser with `?roomId=`

---

## 6. File index (audit evidence)

| Area | Paths |
|---|---|
| Layout CRUD | `app/admin/layouts/*`, `types/index.ts` (`OutputLayoutDoc`) |
| Permissions | `lib/permissions/roles.ts`, `firestore.rules` (`outputLayouts`, `rooms`) |
| Room model | `types/index.ts` (`RoomDoc`), `lib/branding.ts`, `lib/rooms.ts`, `RoomEditClient.tsx` |
| Session stub | `SessionDoc.outputLayoutTemplateId` (types only) |
| RTDB | `lib/rtdbPaths.ts`, `database.rules.json`, `LiveCaptionFeed.tsx`, `functions/src/onSessionEnd.ts` |
| Live-by-room | `lib/attendee/load.ts` (`liveSession`), `app/(attendee)/room/[roomId]/page.tsx` |
| Proxy public note | `proxy.ts` |
| Operator | `electron-spike/renderer-src/App.jsx` (`OperatorInstructions`, `selectedRoomId`) |
| Prior gating note | `electron-spike/SLICE_2B_AUDIT_AND_PLAN.md` |
