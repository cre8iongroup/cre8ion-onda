# Audit: Show-level Transcription style + Operator Instructions

**Status:** Audit / proposal only — no implementation in this pass.  
**Audience:** Alex + Claude (review before any implementation prompt)  
**Date:** 2026-07-29  
**Branch:** `cursor/audit-show-transcription-operator-settings-bf26`  
**Scope:** Where `transcriptionStyle` and `operatorInstructions` should live, who writes them, who reads them, and what already exists for Deepgram presets / markdown.

---

## Verdict (short)

Store both as **flat optional fields on the show document** (`shows/{showId}`), matching `techCredential`, `portalPublished`, and `rooms` — not a new nested `settings` object and not a subcollection. Slot admin UI into **Show Detail** as a new panel beside Tech access / Rooms. Extend the existing **`POST /api/tech/unlock`** payload so Operator Instructions ride the same path as rooms/labels; thread `transcriptionStyle` from unlock (or a re-read of the show doc) into the Electron `createSdkUpload` / Deepgram preset resolution. There is **no markdown library and no rich-text admin input** in the repo today.

---

## 1. ShowDoc schema (as the codebase defines it today)

### Live Firestore caveat

This environment has **no Firebase Admin credentials** (`GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_SERVICE_ACCOUNT_JSON` unset), so live `shows/*` documents could not be sampled. Below is the **authoritative app schema**: TypeScript `ShowDoc` in `types/index.ts`, plus every create/update site that writes show fields. Existing shows in `cre8ion-onda` should match this shape for fields the app has already written; optional fields may be missing on older docs.

### Current `ShowDoc` fields (`types/index.ts`)

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Show title |
| `clientName` | `string` | Client / org label |
| `startDate` | `Timestamp` | |
| `endDate` | `Timestamp` | |
| `glossary` | `GlossaryEntry[]` | Created as `[]`; DeepL sync reads it |
| `deepLGlossaryIds?` | `Record<string, string>` | Written by Cloud Function `syncDeepLGlossary` |
| `branding` | `ShowBranding` | Nested object (see below) — **only cohesive nested settings group on ShowDoc** |
| `defaultLanguages` | `string[]` | e.g. `['en','es']`; seeded on create |
| `portalPublished` | `boolean` | Displayed in Admin as Published/Draft; **written `false` on create only** — no Admin UI found that flips it later |
| `rooms?` | `ShowRoom[]` | `{ id, name }[]` — explicit comment: **array on ShowDoc, not a subcollection** (`lib/rooms.ts`) |
| `techCredential?` | `string` | Shared Operator unlock secret; Admin-managed |
| `archivedAt?` | `Timestamp` | Typed; no Admin write path found in this pass |
| `createdAt` | `Timestamp` | |
| `createdBy` | `string` | uid |

### Nested `ShowBranding` (on the show doc, not a subcollection)

`primaryColor`, `secondaryColor`, `logoURL`, `endSessionBehavior`, `endSessionMessage?`, `redirectURL?`, `portalURL`

Defaults are set in `CreateShowModal` only. **No post-create branding editor** was found under `app/admin/`.

### Related hierarchy (not on ShowDoc itself)

- Subcollection: `shows/{showId}/sessions/{sessionId}` (`SessionDoc`)
- Subcollection: `.../transcripts/{chunkId}` (server-write only)
- Sibling collections: `users`, `outputLayouts`, `auditLog`
- Firestore rules (`firestore.rules`): show doc is a single document with `sessions` nested; **no `settings` match** and no other show-level subcollections.

### Existing pattern for admin-configurable per-show settings

There is **no generic “show settings” form**. Post-create, Admin mutates the show doc via **focused panels on Show Detail**:

1. **`TechCredentialPanel`** — `updateDoc(shows/{id}, { techCredential })` (+ Auth provision side effect)
2. **`RoomsPanel`** — `updateDoc(shows/{id}, { rooms: next })` (also writable from `CreateSessionModal` when creating a room inline)

Create-time seeding is in **`CreateShowModal`** (`addDoc` full `ShowDoc`). Cloud Functions update `deepLGlossaryIds` only.

**Pattern summary:** scalar / array / one nested domain object (`branding`) live **on the show document**. Operator-facing catalog data (`rooms`) is deliberately **not** a subcollection. Unlock reads the show doc once via Admin SDK and projects a slim DTO.

---

## 2. Recommendation: where `transcriptionStyle` + `operatorInstructions` should live

### Recommendation: **flat optional fields on `ShowDoc`**

```ts
// Proposed (for review — not implemented)
transcriptionStyle?: 'standard' | 'lightweight'  // or product-approved enum strings
operatorInstructions?: string                    // markdown source
```

### Why (audit-grounded, not preference)

| Option | Fit to existing codebase |
|---|---|
| **Flat fields (recommended)** | Matches `techCredential`, `portalPublished`, `defaultLanguages`, and how Admin panels already `updateDoc` one/few keys on `shows/{id}`. Unlock already loads the full show doc and cherry-picks fields into `UnlockedShow` — adding two more projected fields is the established path. |
| Nested `settings: { … }` object | **No precedent.** Closest nested group is `branding`, which is a multi-field domain (colors, logo, end behavior, portal slug). These two fields are Operator/transcription concerns, not branding. Introducing a new nest would be a fresh pattern without an existing writer/reader. |
| Subcollection (`shows/{id}/settings/…`) | **Contradicts** the explicit rooms decision (“not a subcollection”). Would require an extra Admin SDK read on unlock, new rules, and no existing UI pattern. Overkill for two scalars. |

### Naming / mapping flag for product review

Repo Deepgram presets today are **`baseline` | `punctuate` | `punctuate_endpointing`** (`lib/recall/deepgramStreamingPresets.json`). Commit/notes already anticipate per-show Transcription style:

- `baseline` — default after Mac A/B; notes say kept until per-show style ships (fastest / smart_format).
- `punctuate` — notes say retained for upcoming style “e.g. **Polished**”.
- `punctuate_endpointing` — reference only (worse in A/B).

The feature brief uses **Standard / Lightweight**, while preset notes use **Polished** language. Implementation must define a single mapping table (e.g. Lightweight → `baseline`, Standard → `punctuate`) and decide whether the third preset stays internal-only. Do not assume names align without Alex sign-off.

### Defaults

- Missing `transcriptionStyle` → behave as today’s global default (`JSON active` / `DEEPGRAM_STREAMING_PRESET`, currently **`baseline`**).
- Missing / empty `operatorInstructions` → Operator UI hides the instructions block (no empty card chrome unless design asks for it).

---

## 3. Where Admin Panel writes ShowDoc fields today

### Create

| Location | What it writes |
|---|---|
| `app/admin/CreateShowModal.tsx` | Full initial `ShowDoc` via `addDoc(collection(fs, 'shows'), payload)` including `portalPublished: false`, `rooms: []`, `techCredential`, nested `branding`, etc. |

### Edit (Show Detail)

| Location | ShowDoc fields |
|---|---|
| `app/admin/shows/[showId]/ShowDetail.tsx` | Host page; loads show with `onSnapshot`; **does not** edit core show fields itself; mounts panels below |
| `…/TechCredentialPanel.tsx` | `techCredential` |
| `…/RoomsPanel.tsx` | `rooms` |
| `…/CreateSessionModal.tsx` | Can append to `rooms` when creating a room; sessions go to subcollection |

### Not present today

- No editor for `portalPublished`, `branding`, `glossary`, `defaultLanguages`, `name`, dates after create (aside from display).
- No `textarea` / markdown / rich-text components under `app/admin/**`.

### Where new fields should slot in

**New section/panel on Show Detail** (`ShowDetail.tsx`), same pattern as Tech access + Rooms:

- Suggested placement: after **Tech access** / **Rooms**, before **Sessions** (or a dedicated “Operator settings” section grouping transcription style + instructions).
- Writer: `updateDoc(doc(fs, 'shows', showId), { transcriptionStyle, operatorInstructions })` with `canEditShows` / `canCreateShows` gating consistent with existing panels.
- Optionally seed defaults in `CreateShowModal` (`transcriptionStyle: 'lightweight'` or whatever product picks as default).

---

## 4. Where Onda Operator reads show / session data

### Primary path (Electron Operator — production direction)

```
Renderer App.jsx  →  IPC spike:unlock
  →  main.js ondaFetch POST /api/tech/unlock
  →  unlockShowByCredential() in lib/tech/sessionLifecycle.ts
  →  Admin SDK: shows where techCredential == …
  →  returns { show, rooms, sessions }
```

**Unlock DTO today** (`UnlockedShow`):

- `id`, `name`, `clientName`, `portalURL` (from `branding.portalURL`)

**Rooms:** projected from `showData.rooms` (sorted).  
**Sessions:** non-draft sessions under the show; `roomName` resolved via `resolveRoomName(rooms, roomId)` (this is the “labels” path for room names + session `friendlyName` / `title`).

Renderer keeps `show`, `rooms`, `sessions` in React state after unlock (`electron-spike/renderer-src/App.jsx` `handleUnlock`). Room/session screens consume those arrays; Input/Network cards live on the **session run** screen (`op-status-grid` under `op-operator-layout`), **after** session select — so Operator Instructions UI should consume show state already held from unlock (or refresh), not a separate fetch.

### Secondary path (web Tech panel — legacy / parallel)

`app/tech/page.tsx` loads the show doc directly from Firestore client after Auth login (not the unlock API). Room labels use `resolveRoomName(show?.rooms, session.roomId)`. If Operator Instructions are Electron-only per brief, web Tech may not need them; confirm product scope.

### Recording context

`spike:select-session` stores `activeContext`: `{ credential, showId, showName, sessionId, sessionLabel, feedState, webhookUrl }` — **no transcription style today**. Style must be added to unlock → renderer and/or `activeContext` before `startRecording` → `createSdkUpload`.

---

## 5. Deepgram preset selection in the recording-start flow

### Current selection (static)

Resolution order in both Next and Electron mirrors:

1. Optional `presetId` argument to `buildDeepgramStreamingConfig` / `resolveDeepgramStreamingPresetId`
2. Else `process.env.DEEPGRAM_STREAMING_PRESET`
3. Else `deepgramStreamingPresets.json` → **`active`** (currently `"baseline"`)
4. Else hard fallback `"baseline"`

**Call sites that build the Recall `deepgram_streaming` payload (neither passes a show-driven preset today):**

| Call site | Behavior |
|---|---|
| `electron-spike/lib/recallApi.js` → `createSdkUpload` | `buildDeepgramStreamingConfig({ language })` — **no presetId** |
| Invoked from `electron-spike/main.js` `startRecording()` after `/api/tech/sessions/start` | Creates sdk_upload, then SDK `startRecording` |
| `app/api/recall/sdk-upload/route.ts` | Same helper; spike/backend helper; returns `deepgramPreset` in JSON |

Shared catalog: `lib/recall/deepgramStreamingPresets.json`  
TS: `lib/recall/deepgramStreamingPresets.ts`  
Electron mirror: `electron-spike/lib/deepgramStreamingPresets.js` (requires the same JSON)

### What must change for show-driven selection (proposal sketch only)

1. Persist `transcriptionStyle` on the show doc (Admin).
2. Project it on unlock (and/or re-read show in a server start helper if Electron should not be trusted as source of truth).
3. Map style → preset id (`baseline` / `punctuate` / …) in one shared place next to `deepgramStreamingPresets`.
4. Pass `presetId` into `buildDeepgramStreamingConfig` from Electron `createSdkUpload` (and optionally from `/api/recall/sdk-upload` if that route remains in use).
5. Keep env/JSON `active` as **dev override / fallback** when the show field is missing — matches current A/B ergonomics until all shows are configured.
6. Decide whether style changes mid-show require restart (presets already document “restart Operator after changing”).

**Authoritative apply moment:** Recall `sdk_upload` creation inside Electron `startRecording` — not caption UI. Operator Instructions are display-only and do not affect this path.

---

## 6. Existing markdown rendering

| Check | Result |
|---|---|
| `package.json` deps | **No** `react-markdown`, `marked`, `remark`, `mdx`, etc. |
| Admin / Electron UI | **No** markdown-to-React usage found |
| `SessionDoc.aiSummary` | Typed comment says “Markdown from Claude”, but `functions/src/summarize.ts` stores **`JSON.stringify(summary)`** — not rendered as markdown anywhere found |
| `dangerouslySetInnerHTML` / `<textarea>` in TSX/JSX | **None** found |

**Implication:** Operator Instructions will need a **new dependency** (or a deliberately tiny custom subset renderer). Prefer a well-known React markdown renderer with sanitization defaults; Electron renderer is Vite + React (not Next), so choose a library that works in both if Admin ever previews the same markdown.

---

## 7. Existing rich-text / markdown input in Admin

**None.** Admin forms use:

- `react-hook-form` + `zod` + plain `<input>` (`CreateShowModal`, user modals, etc.)
- Controlled `<input>` in `TechCredentialPanel` / `RoomsPanel`
- **Zero** `<textarea>` usages in the app UI today

For Operator Instructions authoring, the minimal fit to existing Admin patterns is a **plain `<textarea>` storing markdown source**, with optional later upgrade to a WYSIWYG. There is no TipTap/Lexical/Quill/etc. to extend.

---

## 8. Proposed implementation surface (for the next prompt — not this PR)

Ordered for surgical commits:

1. **Types + Admin panel** — add flat fields; Show Detail panel; optional CreateShow default.
2. **Unlock DTO** — extend `UnlockedShow` + Electron renderer state; render read-only markdown under Input/Network (`op-status-grid` / below it).
3. **Deepgram mapping** — style → preset; pass `presetId` from unlock/`activeContext` into `createSdkUpload`.
4. **Markdown dep + Operator render** — add library; sanitize; empty-state hide.
5. **Docs / mapping table** — Standard vs Lightweight vs preset ids signed off by Alex.

Out of scope unless asked: flipping `portalPublished`, branding editor, web `/tech` Operator Instructions, env-preset deprecation.

---

## Key file index

| Concern | Path |
|---|---|
| ShowDoc type | `types/index.ts` |
| Create show | `app/admin/CreateShowModal.tsx` |
| Show detail host | `app/admin/shows/[showId]/ShowDetail.tsx` |
| Tech credential write | `app/admin/shows/[showId]/TechCredentialPanel.tsx` |
| Rooms write | `app/admin/shows/[showId]/RoomsPanel.tsx` |
| Rooms “not a subcollection” | `lib/rooms.ts` |
| Unlock API | `app/api/tech/unlock/route.ts` |
| Unlock + DTO | `lib/tech/sessionLifecycle.ts` (`unlockShowByCredential`, `UnlockedShow`) |
| Operator UI | `electron-spike/renderer-src/App.jsx` |
| Unlock IPC | `electron-spike/main.js` (`spike:unlock`, `startRecording`) |
| Deepgram presets | `lib/recall/deepgramStreamingPresets.{json,ts}` |
| Electron preset apply | `electron-spike/lib/recallApi.js`, `electron-spike/lib/deepgramStreamingPresets.js` |
| Next sdk-upload helper | `app/api/recall/sdk-upload/route.ts` |
| Firestore rules | `firestore.rules` |

---

## Open questions for Alex + Claude

1. Confirm product labels: **Standard / Lightweight** vs preset notes’ **Polished**, and exact preset mapping.
2. Should `transcriptionStyle` be required on create with a default, or optional with global JSON/env fallback?
3. Operator Instructions: Electron-only, or also web `/tech`?
4. Markdown subset allowed (headings, lists, links, bold only?) for Operator safety.
5. If Admin changes style while Operator is unlocked, is unlock-time snapshot enough until re-unlock / restart?
