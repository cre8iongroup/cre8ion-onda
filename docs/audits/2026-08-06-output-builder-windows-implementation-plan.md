# Implementation Plan: Output Builder + Output Windows

**Status:** Plan only — no implementation in this pass.  
**Audience:** Alex + team (sanity-check before coding)  
**Date:** 2026-08-06  
**Depends on:** Audit `docs/audits/2026-08-06-output-builder-windows-audit.md` + locked decisions in the implementation prompt.  
**Branch:** `cursor/audit-output-builder-windows-d621` (plan appended; implementation will use a separate feature branch when approved)

---

## 0. Tech login verification (step 1)

### Verdict: **Fully functional for web Builder auth — reuse as-is. No new auth work.**

The `/tech/login` shared-per-show flow is wired end-to-end, not a stub:

| Step | Mechanism | Status |
|---|---|---|
| Provision | Admin sets show `techCredential` → `provisionTechAuthUser()` creates Auth user `tech+{portalSlug}@onda.tech` with that password + Firestore `users/{uid}` (`baseRole: 'tech'`, `assignedShows: [showId]`) | Built (`lib/tech/provisionTechUser.ts`, `TechCredentialPanel`, also on show create) |
| Login UI | `/tech/login` — portal slug + credential → `signInWithEmailAndPassword(techEmailForPortalSlug(slug), credential)` → sets `onda-session` cookie → redirects to `?from=` if under `/tech` | Built (`app/tech/login/page.tsx`) |
| Middleware | `/tech/*` protected except `/tech/login`; redirects unauthenticated to `/tech/login?from=…` | Built (`proxy.ts`) |
| Layout gate | Requires Firebase user + `capabilities.canAccessTechPanel` (true for `tech` and `admin` roles) | Built (`app/tech/layout.tsx`, `lib/permissions/roles.ts`) |
| Post-login data | Tech sessions page loads `assignedShows[0]` show + sessions via client Firestore | Built (`app/tech/page.tsx`) |

**Implications for Phase C / E:**

- Builder under `/tech/output…` inherits the existing redirect-to-login behavior when unauthenticated. Operator link-out needs **no special-casing**.
- Electron Operator unlock (`POST /api/tech/unlock`) is a **separate** credential check and does **not** create a Firebase `/tech` session. Tech who only unlocked Operator will still hit `/tech/login` the first time they open the Builder — expected and already accepted in the locked decisions.

**Known ops caveats (not blockers, not in scope to fix here):**

1. If a tech Auth user already exists for a portal slug, credential save does **not** rotate the Auth password (`existed: true` path in `provisionTechAuthUser`). Admin UI already warns. Builder login fails if the stored show credential was rotated without Auth rotation.
2. `onda-session` is a presence cookie for middleware only; real auth is Firebase client SDK (same as admin login). Fine for Builder.

**Phase C needs zero new auth surfaces.**

---

## Proposed routes & naming

| Surface | Proposed path | Auth |
|---|---|---|
| Output Builder | `/tech/output` (+ `?showId=&roomId=` deep link) | `/tech` session (existing) |
| Output Window | `/output/[roomId]/[windowIndex]` | Public |
| Preset admin | Keep `/admin/layouts`; rename nav label → **Output Presets** | Admin (`canManageOutputLayouts`) |

Rationale for `/tech/output`: matches existing Tech nav siblings (`/tech`, `/tech/network`); stays inside the already-gated Tech shell; deep-link friendly for Operator.

Open for confirmation if you’d rather `/tech/output-builder` for clarity — functionally identical.

---

## Shared types (touched once, used by all phases)

**File:** `types/index.ts`

```ts
interface OutputWindowConfig {
  language: string | null
  fontSize: number              // px
  backgroundColor: string       // hex or named (e.g. chroma green)
  textColor?: string            // unset → inherit show branding at render
}

interface RoomOutputConfig {
  windows: OutputWindowConfig[]
  updatedAt?: Timestamp
  updatedBy?: string
}

// RoomDoc += outputConfig?: RoomOutputConfig
// OutputLayoutDoc → { name, windows: OutputWindowConfig[], createdBy, createdAt }
// Remove SessionDoc.outputLayoutTemplateId
```

Optional shared helpers (new small module, avoid scattering magic numbers):

- `lib/output/defaults.ts` — default window configs, chroma swatch constant (`#00FF00`), seed from `defaultLanguages[0]`
- `lib/output/resolveTextColor.ts` — `window.textColor ?? branding.textColor`

---

## Phase A — Data model & rules

| Change | Files |
|---|---|
| Types as above | `types/index.ts` |
| RTDB path helpers | `lib/rtdbPaths.ts` — add `rtdbOutputLivePath(roomId)`, optionally `rtdbOutputLiveWindowsPath(roomId)` |
| RTDB security | `database.rules.json` — sibling tree: `"outputLive": { "$roomId": { ".read": true, ".write": "auth != null" } }` |
| Firestore room write narrowing | `firestore.rules` — under `match /rooms/{roomId}`: keep admin/editor full create/update/delete; add tech branch: `isTech() && isAssignedToShow(showId) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['outputConfig'])` (mirror session `feedState` pattern) |
| Confirm `outputLayouts` rules still fit | Same file — create/update already allow tech; schema change only |
| Remove unused session field | `types/index.ts` only (`outputLayoutTemplateId`) |
| Preset type reshape | `types/index.ts` (`OutputLayoutDoc`); drop unused `FontSize` / `BackgroundType` / `CaptionLayout` **if** nothing else imports them after reshape (grep-driven; attendee uses its own text-size union) |
| Seed helpers | `lib/output/defaults.ts` (new) |

**Explicit non-touch:** `functions/src/onSessionEnd.ts` — already only deletes `liveSessions/{sessionId}`; no change needed if `outputLive` is a separate root (will add a one-line comment in `lib/rtdbPaths.ts` documenting that separation).

**Orphaned old `outputLayouts` docs:** no migration script in this pass. Plan default: **leave orphaned in Firestore**; new Create/List UI only understands `{ name, windows[] }` (old docs may render poorly or be filtered). Confirm wipe vs leave before coding Phase D — recommend leave (no prod value yet; wipe is a one-liner console delete if desired).

**Parked idea (comment only if a natural hook exists):** no per-room test session — e.g. a short comment near live-session resolution in the Output Window loader: `// Future: optional room-scoped test/preview session — out of scope`.

---

## Phase B — Output Windows (public)

| Piece | Files |
|---|---|
| Route group + page | `app/(output)/output/[roomId]/[windowIndex]/page.tsx` (+ minimal `layout.tsx` if needed for zero chrome) |
| Client caption + live config UI | `app/(output)/output/[roomId]/[windowIndex]/OutputWindowClient.tsx` (new) |
| SSR data loader | Extend `lib/attendee/load.ts` **or** add `lib/output/load.ts` that reuses `loadPublicRoomById` / live-session find — prefer thin `lib/output/load.ts` wrapping existing helpers to avoid bloating attendee types with `outputConfig` |
| Public API (optional, if SSR needs a refresh path) | Only if client re-resolve of live session can’t stay on Admin SDK SSR + Firestore listener; prefer: SSR seed via Admin SDK; client watches RTDB `feedState` of resolved session + `outputLive/{roomId}` |
| Styles | Dedicated minimal CSS module or inline — **no** attendee chrome, footer, language picker, font controls |
| Proxy | `proxy.ts` — no code change required (`/output` already outside `PROTECTED_PREFIXES`); maybe tighten the existing comment |

**Behavior:**

1. SSR: resolve room (published show) + `liveSession` where `feedState === 'live'` + branding text color + optional Firestore `outputConfig.windows[windowIndex]` for first paint.
2. Invalid `windowIndex` → idle/error state (not 500).
3. No live session → idle/waiting (intentional during `testing`).
4. Client: subscribe `liveSessions/{sessionId}/chunks` only while live (same pattern as `LiveCaptionFeed`); map via `mapChunksForCaptionLanguage` / `buildCaptionDisplayLines` using window language (null language → idle placeholder, not English fallback).
5. Client: `onValue(outputLive/{roomId})` → apply `windows[windowIndex]` fontSize / backgroundColor / resolved textColor as CSS.
6. When live session ends / changes: re-resolve (listen to room sessions’ `feedState` via public API poll or Admin-free approach — **constraint:** anonymous can’t read Firestore. Options: (a) SSR + periodic refetch of `GET /api/public/rooms/{roomId}` which already returns `liveSession`; (b) extend that public API if needed). Prefer (a) reusing `app/api/public/rooms/[roomId]/route.ts` + short interval or focus/visibility refetch; also subscribe RTDB `feedState` on the known session id and clear when it leaves `live`.

**Text color resolve:** `window.textColor ?? effectiveBranding.textColor` (`lib/branding.ts` / `DEFAULT_TEXT_COLOR`).

---

## Phase C — Output Builder (Tech)

| Piece | Files |
|---|---|
| Page | `app/tech/output/page.tsx` |
| Client editor | `app/tech/output/OutputBuilderClient.tsx` (new) |
| Nav entry | `app/tech/layout.tsx` — add `{ href: '/tech/output', label: 'Output', … }` to `TECH_NAV` |
| Write helpers | `lib/output/writeLiveConfig.ts` (throttle RTDB `set`/`update`) + Firestore `updateDoc` debounce in the client component (or shared hook `useDebouncedOutputConfig`) |
| Preset read (optional first-run) | Client read `outputLayouts` if `canManageOutputLayouts` / signed-in — already allowed by rules |
| Deep link | Read `useSearchParams()` for `roomId`, `showId` |

**UI (exactly 2 window editors for now):**

- Language select (en/es/pt/fr + “Unset” for null)
- Font size: number input or slider (px)
- Background: swatches including chroma-key green `#00FF00` + free hex
- Text color: show inherited brand value with “Inherited from brand” until overridden; clear override returns to inherit (`textColor` field omitted/deleted — **omit field, never write `undefined`**)
- “Open Window 1” / “Open Window 2” → `window.open(/output/{roomId}/{i})`
- No in-Builder preview panel

**Show / room selection:**

- Tech with one `assignedShows` entry: auto-select show; room dropdown from `shows/{id}/rooms` (canonical subcollection) or denormalized `show.rooms[]`.
- Admin with tech panel + multiple shows: show picker then room picker.
- Deep link `?roomId=` (and optional `?showId=`): jump straight to editor when resolvable within assigned shows.

**First-run seed (no `outputConfig` yet):**

1. If Builder offers preset picker and Tech picks one → copy `preset.windows` into room config (independent thereafter).
2. Else hardcoded defaults from `lib/output/defaults.ts`: two windows; `[0].language = show.defaultLanguages[0] ?? 'en'`; `[1].language = null`; shared sensible fontSize/backgroundColor; no `textColor` (inherit).

**Writes:**

- Control change → throttle ~75ms → `set(ref(db, outputLive/{roomId}), { windows })` (auth’d tech)
- Same change → debounce ~400–500ms → `updateDoc(roomRef, { outputConfig: { windows, updatedAt, updatedBy } })`
- On Builder mount: if Firestore has config but RTDB empty/stale, hydrate RTDB once from Firestore so open Windows sync immediately.

**Parked:** no room test-session controls.

---

## Phase D — Preset library (minimal reshape)

| Piece | Files |
|---|---|
| Create modal rewrite | `app/admin/layouts/CreateLayoutModal.tsx` — name + 2 window editors (same field set as Builder windows, no speaker labels / layout / template textColor) |
| List dashboard | `app/admin/layouts/LayoutsDashboard.tsx` — preview from `windows[]`; copy “Output Presets” |
| Page metadata / nav label | `app/admin/layouts/page.tsx`, `app/admin/layout.tsx` (label **Output Presets**) |
| Types already reshaped in A | — |

**Rules:** do not write optional fields as `undefined`. Use object spread / omit. Preset apply is Builder-only (Phase C), never a live room→preset reference.

**Old docs:** display filter — if `!Array.isArray(doc.windows)`, skip or show “legacy (unsupported)” badge; no migration.

---

## Phase E — Operator link-out

| Piece | Files |
|---|---|
| IPC: open URL in system browser | `electron-spike/main.js` — `ipcMain.handle('spike:open-external-url', … shell.openExternal(url))` (validate http/https against `CONFIG.ondaApiBase` host or allowlist) |
| Preload bridge | `electron-spike/preload.js` — expose `openExternalUrl(url)` |
| Renderer stub | `electron-spike/renderer-src/ondaSpike.js` — passthrough |
| UI control | `electron-spike/renderer-src/App.jsx` — near `OperatorInstructions` / Input-Network grid: “Open Output Builder” button → `${CONFIG.ondaApiBase}/tech/output?roomId=${selectedRoomId}` or `/tech/output` if no room |

Reuse existing `shell.openExternal` pattern from OS settings; do **not** open inside Electron BrowserWindow.

---

## Phase order & PR strategy

1. **A** alone is mergeable (types + rules + path helpers) — no UI yet; safe.
2. **B** next — public Windows can be manually tested with seeded Firestore/RTDB.
3. **C** — Builder drives the live loop.
4. **D** can parallelize with C after A (preset schema), but Builder first-run preset picker needs D’s shape.
5. **E** last (or with C once Builder path is stable).

Suggested implementation branch when approved: `cursor/feat-output-builder-windows-d621` (or split A/B vs C/D/E if review prefers smaller PRs). Base: `main` unless instructed to target `development`.

---

## Explicit non-goals (will not appear in PRs)

- 16:9 branded frame / QR / session title fields
- In-window editing
- OS window position persistence
- Multi-room Builder state
- Per-room test/preview session (comment-only park)

---

## Confirmations requested before coding

1. Builder path **`/tech/output`** OK? (vs `/tech/output-builder`)
2. Orphaned old `outputLayouts` docs: **leave** vs wipe?
3. Public live-session refresh for Windows: OK to reuse/extend `GET /api/public/rooms/[roomId]` rather than a new endpoint?
4. Electron Builder URL base = existing `CONFIG.ondaApiBase` (same as API) — confirm for prod (`https://cre8ion-onda.app`) and local.
5. Any objection to filtering legacy preset docs in the admin list instead of a migration?
