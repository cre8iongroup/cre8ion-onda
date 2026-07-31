# Phase 5 — Attendee navigation, light CMS, QR codes

**Status:** Audit + implementation plan only (no code in this pass)  
**Date:** 2026-07-31  
**Scope:** Show home / Room / Session public routes, Room entity promotion, Show links CMS, QR generation, Contributor role  
**Out of scope:** DeepL fan-out, Review panel (Phase 6/7), Onda explainer page

---

## Part 1 — Audit findings

### 1. Session / Show data model

#### Session “room” field — **belief was outdated**

| Belief | Actual |
| --- | --- |
| `Session.room` is a free-text string | **Already gone.** `SessionDoc.roomId: string` references `ShowDoc.rooms[].id` |

Evidence:

- `types/index.ts` — `SessionDoc.roomId` with comment: *“References ShowDoc.rooms[].id — required; free-text location removed.”*
- Landed in commits `c493020` / PR #20 (`feat(admin): show rooms catalog and session roomId`) and Operator room nav PR #21.

#### Current Room shape — **not a Room entity yet**

Rooms today are an **embedded array on the show document**, not a collection:

```ts
// ShowDoc
rooms?: ShowRoom[]

interface ShowRoom {
  id: string
  name: string
}
```

Helpers: `lib/rooms.ts` (create id, normalize/uniqueness, resolve name).  
Admin UI: `app/admin/shows/[showId]/RoomsPanel.tsx` (inline add/rename/remove on Show Detail).  
Session create: `CreateSessionModal` requires `roomId`; can inline-create a room into `show.rooms`.  
Operator unlock: `lib/tech/sessionLifecycle.ts` projects `show.rooms` into the unlock payload and resolves `roomName` from `roomId`.

**Missing vs Phase 5 target Room entity:** `showId` as a first-class doc field, `branding { inherit, logoUrl, backgroundColor, textColor, accentColors[] }`, `qrCodeUrl`. No Room edit page; no per-room branding; no QR.

#### Show branding schema — **exists; richer and differently named than Phase 5 palette**

```ts
interface ShowBranding {
  primaryColor: string        // hex
  secondaryColor: string      // hex
  logoURL: string             // Firebase Storage URL
  endSessionBehavior: EndSessionBehavior  // 'message' | 'showTranscript' | 'redirect' | 'brandedEndCard'
  endSessionMessage?: string
  redirectURL?: string
  portalURL: string           // slug (create-time; used as /portal/[slug] in copy)
  legalNotice?: string        // admin-stored; attendee render deferred to Phase 5
}
```

Defaults on create (`CreateShowModal`): `primaryColor: '#5b3aee'`, `secondaryColor: '#00d4aa'`, empty `logoURL`, `endSessionBehavior: 'message'`.

**Gaps / conflicts with Phase 5 palette-only branding:**

| Phase 5 target | Current |
| --- | --- |
| `logoUrl`, `backgroundColor`, `textColor`, `accentColors[]` | `logoURL`, `primaryColor`, `secondaryColor` — **no** dedicated background/text colors |
| Palette only for v1 | Also: end-session behavior, redirect, portal slug, legal notice |
| Admin-editable branding | **No post-create branding editor** (only `legalNotice` panel). `canManageBranding` exists in the capability matrix but is unused in UI |
| `Show.links: [{title, url, order}]` | **Does not exist** |
| Show home at `/show/{slug}` | Copy and middleware comments still say `/portal/[slug]` |

`portalPublished: boolean` exists (always `false` on create) and is displayed as Published/Draft, but **no Admin UI flips it**.

---

### 2. QR code generation

| Check | Result |
| --- | --- |
| Dependency | **`qrcode` ^1.5.4** and **`@types/qrcode` ^1.5.6** already in root `package.json` |
| Application usage | **None** — no imports of `qrcode` / `QRCode` anywhere in app, lib, functions, or scripts |
| `electron-spike/` | No QR dependency or generation code |
| Mentions only | Comment on `app/page.tsx` (*attendees land at `/session/{sessionId}` via QR*); Operator standby copy in `electron-spike/SLICE_2B_PLAN.md` |

**Verdict:** Library is pre-provisioned; generation, storage, and download UI are entirely greenfield.

---

### 3. Admin panel structure & permissions

#### Sidebar / routes

| Nav item | Route | Notes |
| --- | --- | --- |
| Shows | `/admin` | List + create |
| Show detail | `/admin/shows/[showId]` | Rooms, Tech, Operator settings, Legal notice, Sessions list |
| Users | `/admin/users` | Admin-only in practice |
| Layouts | `/admin/layouts` | Output layout templates |

**No** `/admin/shows/[showId]/rooms/[roomId]`, **no** `/admin/shows/[showId]/sessions/[sessionId]`. Sessions can be created and toggled Hide/Reset on the list; they **cannot be opened or edited**.

Admin layout gate (`app/admin/layout.tsx`): requires `canCreateShows` **or** `canManageUsers`. Anyone without those caps is redirected unauthorized — relevant for a QR-only Contributor.

#### Roles today

`BaseRole = 'admin' | 'editor' | 'tech' | 'reviewer'` — **no Contributor**.

Defaults in `lib/permissions/roles.ts` (`BASE_ROLE_CAPS`). Effective caps via `resolveCapabilities` in `lib/permissions/check.ts`.

#### Permission overrides — **can ADD and RESTRICT**

From `lib/permissions/check.ts`:

> `customPermissions` values of `true` or `false` override the base role. Undefined falls back to role default.

Create-user UI (`CreateUserModal`) exposes per-capability **Role default / Force allow / Force deny**. So an Editor *can* be restricted below role defaults in the **capability resolver / client UI**.

#### Critical caveat — Firestore (and some Functions) ignore overrides

`firestore.rules` authorize writes with **`getRole() in ['admin', 'editor']`** (`isAdminOrEditor()`). They do **not** read `customPermissions`.

Consequence: a “restricted Editor” with `canEditShows: false` (and similar denies) **still has full show/session write access at the rules layer**. Client UI may hide buttons; the user can still write via console/API.

Same pattern in Cloud Functions (`summarize.ts`, `syncDeepLGlossary.ts`): gate on `baseRole in ['admin', 'editor']`, not resolved capabilities.

Server API helpers (`lib/admin/requireAdminUser.ts` + `requireShowEditCapability`) **do** use resolved capabilities — inconsistent with rules.

**Direct answer:** Overrides **can** restrict in the app capability model, but **cannot** securely restrict an Editor today because security rules and several Functions key off `baseRole` only. Contributor **must not** be “restricted Editor” if QR-only is a hard security boundary; it needs its own `baseRole` (and/or rules that respect capabilities).

---

### 4. Attendee-facing / public routes

| Exists today | Auth | Purpose |
| --- | --- | --- |
| `/` | redirects → `/admin` | Staff default |
| `/login`, `/reset-password` | public | Auth |
| `/docs`, `/docs/[slug]` | public (proxy) | Internal docs |
| `/download`, `/download-success` | public | Operator installer |
| `/admin/*` | protected | Admin |
| `/tech/*` (except `/tech/login`) | protected | Web tech panel |
| `/review/*` | protected shell | Review (Phase 6/7) |

**Missing entirely:** `/show/[slug]`, `/room/[roomId]`, `/session/[sessionId]`, `/show/[slug]/sessions`, and any `/portal/[slug]` implementation (only mentioned in comments / create-show copy).

`proxy.ts` already treats non-`/admin|/tech|/review` paths as public and documents that attendee/output views need no auth. RTDB rules already allow **public read** of `liveSessions/{id}/feedState` and `chunks` (attendee gate intended client-side on `feedState`).

**Blocker:** Firestore rules require **signed-in + assigned-to-show** for all show/session reads. Anonymous attendees **cannot** load show schedule, room, or session metadata from Firestore as written today. Storage allows public read of show logos (`logo.*`) only; no QR paths yet.

PWA scaffolding (`next-pwa`, `public/manifest.json`, RTDB cache) exists; no attendee UI consumes it yet. `sessionStatusLabel` explicitly defers attendee formatting to Phase 5.

---

### Surprises / plan conflicts (summary)

1. **Room free-text migration is already done** — Phase 5 work is *promoting* `ShowRoom[]` → full Room docs + branding/QR, not inventing `roomId`.
2. **`qrcode` is already a dependency** — unused.
3. **Slug path naming split:** product target `/show/{slug}` vs codebase `/portal/[slug]` + `branding.portalURL`.
4. **Branding field naming / shape mismatch** with Phase 5 palette; plus unused end-session fields and no branding editor.
5. **Public Firestore read model is missing** — largest backend risk for attendee pages.
6. **Contributor-as-restricted-Editor is insecure** under current rules.
7. **Operator unlock + Electron** still depend on embedded `show.rooms` — Room entity promotion must not break Phase 4 Operator.

---

## Part 2 — Target design (accepted; restated for plan anchoring)

- **Room entity:** `id`, `showId`, `name`, `branding { inherit, logoUrl, backgroundColor, textColor, accentColors[] }`, `qrCodeUrl`
- **Session.roomId** stays (already present); free-text not returning
- **Show.links:** `[{ title, url, order }]` — admin-editable, no visibility rules in v1
- **Show branding** remains default inheritance source for rooms
- **Public routes:** `/show/{slug}`, `/room/{roomId}`, `/session/{sessionId}`, `/show/{slug}/sessions`
- **QR:** every Room and Session; downloadable SVG and/or PNG
- **Roles:** Admin, Editor, **Contributor** (new; no session edit; QR access), Tech, Reviewer
- **Out of scope:** DeepL, Review panel, Onda explainer

---

## Part 3 — Implementation plan

### A. Data model migration path

#### Recommended storage layout

Prefer **subcollection** (keeps show scoping, matches sessions pattern):

```
shows/{showId}
  rooms/{roomId}          ← promote from ShowDoc.rooms[]
  sessions/{sessionId}    ← unchanged path; roomId already set
```

Alternative (top-level `rooms/{roomId}` with `showId`) works but needs a new collection-group query habit and looser routing. Subcollection is the smaller conceptual jump from today.

Proposed `RoomDoc`:

```ts
interface RoomDoc {
  name: string
  branding: {
    inherit: boolean          // true → use Show branding for palette
    logoUrl?: string
    backgroundColor?: string
    textColor?: string
    accentColors?: string[]   // 1–2
  }
  qrCodeUrl?: string          // Storage download URL or path — see QR section
  createdAt: Timestamp
  createdBy: string
  // showId is implicit via path if subcollection; store explicitly only if top-level
}
```

Show additions:

```ts
links?: Array<{ title: string; url: string; order: number }>
```

Show branding: **keep existing fields** for v1; map into attendee CSS variables (see Branding below). Do **not** rename `logoURL` / `primaryColor` in this phase unless product insists — remapping in a resolver is cheaper than a field rename migration. Optionally add `backgroundColor` / `textColor` on `ShowBranding` if primary/secondary are insufficient for “background + text + accents”; treat as an open question.

Session: add `qrCodeUrl?: string` (and keep `roomId`).

#### Migrating existing rooms — **manual or tiny one-shot script; IDs already stable**

Because rooms already have UUIDs and sessions already store those IDs:

1. For each show, for each entry in `show.rooms[]`, create `shows/{showId}/rooms/{id}` with `{ name, branding: { inherit: true }, createdAt, createdBy }`.
2. **Do not rewrite `session.roomId`** if document IDs are preserved.
3. Decide dual-read period for Operator:
   - **Short dual-write (recommended):** keep updating `ShowDoc.rooms[]` as a denormalized `{id,name}[]` when Room docs change, so unlock/Electron keep working unchanged in Phase 5a; or
   - **Update unlock immediately** to read the rooms subcollection and drop the array.

Given small show count, a **one-time Admin SDK / `npx tsx` script** (matching existing REST-or-admin script patterns) is enough; manual Console copy is fine for 1–2 shows but a script is less error-prone and repeatable on staging → prod. No fuzzy free-text → room matching is required.

Deprecate reading the embedded array only after Operator unlock is updated (or dual-write is proven).

#### Indexes

Room schedule queries will need something like:

- collection group or subcollection: `roomId` + `scheduledStart` (and possibly `isDraft`)

Today’s indexes cover `isDraft`+`scheduledStart` and `feedState`+`scheduledStart` on sessions — **not** `roomId`. Plan a `firestore.indexes.json` addition early.

Slug lookup for `/show/{slug}`: either query `branding.portalURL == slug` (may need a single-field index / careful uniqueness) or maintain a `portalSlugs/{slug} → showId` map. Uniqueness of `portalURL` is **not enforced in code today** — open risk.

---

### B. Public Firestore / Storage access (prerequisite)

Without this, attendee pages cannot load.

**Firestore (illustrative policy — finalize in build):**

- Public **read** of a show when `portalPublished == true` (recommended gate), exposing only fields the UI needs (or accept full-doc public read for published shows and scrub secrets).
- **`techCredential` must never be client-readable publicly.** Today it lives on the show doc and is readable by any assigned signed-in user. Public show read **must** either:
  - move credential to a non-public path / Cloud Function-only field, or
  - serve attendee show payloads via a **server route / Admin SDK** that strips secrets.
- Public **read** of non-draft sessions (`isDraft != true`) for published shows; public **read** of rooms under published shows.
- Transcript chunks in Firestore: keep **non-public** for attendees if live captions come from RTDB only (current design). Confirm attendees never need Firestore transcripts in v1.

**Strong recommendation:** Attendee pages use **Next.js server components / Route Handlers with Admin SDK** to load show/room/session metadata, and client RTDB only for the live feed. That avoids loosening Firestore rules around `techCredential` and matches “no-login” without anonymous Auth.

If client Firestore is preferred, strip `techCredential` from the show document into `shows/{id}/private/tech` (or Secret Manager) **before** opening public reads — treat as a **high-risk** sub-task.

**Storage:** public read for QR objects (and continue logo public read). Writes: authenticated admin/editor (and Contributor if they only download, not upload).

---

### C. Proposed routes & component breakdown

All attendee routes: **no login** (already outside `PROTECTED_PREFIXES` in `proxy.ts`). Use a light shared layout (branding CSS variables, footer), not the admin panel shell.

| Route | Purpose | Main pieces |
| --- | --- | --- |
| `/show/[slug]` | Show home | Resolve slug → show; hero branding; ordered `links`; entry points (rooms list and/or “browse sessions”); footer `"{name} · Powered by cre8ion Onda"` (+ optional `legalNotice` markdown, restricted subset) |
| `/room/[roomId]` | **Primary QR target** | Resolve room (+ parent show); effective branding; **Current live** card only if a non-draft session in this room has `feedState === 'live'` (omit entirely otherwise — no empty placeholder); multi-day schedule grouped by day; live row highlighted in-list; rows link to `/session/{id}` |
| `/session/[sessionId]` | Live captions | Load session + show branding; subscribe RTDB `feedState` + chunks; **gate UI strictly on `feedState === 'live'`**, never on chunk presence; non-live → calm waiting / ended state (no caption stream) |
| `/show/[slug]/sessions` | Browse-all fallback | Flat or day-grouped list of non-draft sessions across rooms |

Suggested shared modules (names indicative):

- `lib/attendee/resolveShowBySlug.ts`
- `lib/attendee/effectiveBranding.ts` — show defaults + room override when `inherit === false`
- `lib/attendee/schedule.ts` — group by local/event day; pick “current live”
- `components/attendee/ShowFooter.tsx`, `ScheduleList.tsx`, `LiveSessionCard.tsx`, `CaptionFeed.tsx`
- `app/show/[slug]/layout.tsx` / `app/(attendee)/…` route group for shared CSS

**Slug field:** continue using `branding.portalURL` as the canonical slug unless product renames; route path becomes `/show/[slug]` (update Admin copy away from `/portal/…`). Optional redirect from `/portal/[slug]` → `/show/[slug]` for any printed materials already using portal wording.

**Draft / publish gates:** hide draft sessions everywhere on attendee surfaces; recommend requiring `portalPublished` for show/room pages (and add Admin toggle — currently missing).

---

### D. QR generation approach

**Library:** use the already-declared **`qrcode`** package (PNG via `toDataURL` / `toBuffer`; SVG via `toString`). No new dependency needed unless product wants a React QR component for live preview (`qrcode.react` optional, not required).

**Payload URL:** absolute production origin + path, e.g. `https://{host}/room/{roomId}` and `https://{host}/session/{sessionId}`. Host should be an env (`NEXT_PUBLIC_APP_URL` or similar) — confirm what exists in `.env.example` at build time.

**When to generate:**

| Strategy | Pros | Cons |
| --- | --- | --- |
| **On-demand from edit page (recommended v1)** | No stale files if URL/host changes; simple create path; Contributor can regenerate | First download latency; must handle missing `qrCodeUrl` |
| On create | Always “ready” | Wrong host in local/staging; harder rotate |

Recommend: **generate on first download / explicit “Generate & download”**, then upload to Storage and persist `qrCodeUrl` (and/or storage path). Offer **Regenerate** if origin or id policy changes. Also allow pure client-side download without Storage if persistence is optional — but target field `qrCodeUrl` implies Storage persistence for reprint consistency.

**Storage paths (suggested):**

```
shows/{showId}/rooms/{roomId}/qr.png
shows/{showId}/rooms/{roomId}/qr.svg
shows/{showId}/sessions/{sessionId}/qr.png
shows/{showId}/sessions/{sessionId}/qr.svg
```

Extend `storage.rules` for public read on those objects; write for signed-in roles that may manage QR (admin/editor; Contributor download-only can use a signed API that streams the file without write permission).

**API shape (optional but clean):** `POST /api/admin/qr` with `{ type: 'room'|'session', showId, id, format: 'png'|'svg' }` → returns file + updates doc. Caps: admin/editor full; Contributor download only (no session field edits).

---

### E. Admin UI changes

#### Show Detail (`/admin/shows/[showId]`)

1. **Rooms section** — evolve from inline name list to a list with links into Room edit; keep quick-add name if desired.
2. **Show links CMS** — new panel: ordered list editor (`title`, `url`, drag or up/down `order`).
3. **Branding editor** (light) — logo upload + palette fields mapped to existing `ShowBranding` (+ any new bg/text fields). Wire to `canManageBranding`.
4. **Publish toggle** for `portalPublished` (needed for public gate).
5. **Sessions list** — each row links to **Session edit** page (new). Keep Hide / Reset as today.

#### New: Room edit — `/admin/shows/[showId]/rooms/[roomId]`

- Name
- Branding: inherit toggle; when off, logo + colors (palette only)
- QR preview + download PNG/SVG
- Deep link display (`/room/{roomId}`)
- Danger: delete only if no sessions reference (same rule as today)

#### New: Session edit — `/admin/shows/[showId]/sessions/[sessionId]`

- Fields editable today only at create: title, friendlyName, roomId, schedule, languages (as applicable)
- Draft visibility, reset (reuse existing actions)
- QR preview + download
- Deep link (`/session/{sessionId}`)
- **No** live-feed controls here (Tech/Operator remain source of truth)

#### Users

- Add **Contributor** to role select
- Capability row for QR (see below)
- Ensure admin shell allows Contributor entry (layout gate today blocks anyone lacking `canCreateShows` / `canManageUsers`)

#### Sidebar

No new top-level nav required; Rooms/Sessions remain under Show. Optional later: global “QR library” — out of scope unless requested.

---

### F. Contributor role — recommendation

**Do not implement Contributor as a restricted Editor.**

Reasons:

1. Firestore rules grant all editors full show/session write via `baseRole`.
2. Several Cloud Functions likewise trust `baseRole`.
3. Admin layout would still need special-casing; overrides alone don’t yield a coherent “QR-only” product role.
4. Force-deny overrides are easy to misconfigure and invisible in rules.

**Implement as first-class `baseRole: 'contributor'`** with defaults roughly:

| Capability | Contributor |
| --- | --- |
| `canCreateShows` / `canEditShows` | false |
| `canManageUsers` | false |
| `canManageBranding` | false |
| `canPublishSessions` | false |
| New: `canDownloadQr` (name TBD) | **true** |
| Tech / review caps | false |

Work items:

- Extend `BaseRole`, `BASE_ROLE_CAPS`, CreateUserModal, UsersDashboard badges
- Firestore: allow Contributor **read** on assigned shows; **deny** session/show writes; optionally allow nothing else
- Admin layout: admit users with `canDownloadQr` (read-only show → room/session QR pages)
- UI: Contributor sees Shows they’re assigned to, can open Room/Session pages for QR download only (hide edit forms or render download-only variants)
- Do **not** rely on Force deny of Editor for this persona

Overrides remain useful for *additive* exceptions (e.g. reviewer + publish) and for soft UI tweaks, but **QR-only must be a role**.

---

### G. Branding resolution (attendee)

```
effective = room.branding.inherit !== false
  ? mapShowBranding(show.branding)
  : { ...mapShowBranding(show.branding), ...room.branding overrides }
```

Map existing show fields into CSS variables already reserved in `globals.css` (“white-label overrides injected via JS for attendee-facing…”):

- `logoURL` → logo
- `primaryColor` / `secondaryColor` → accents (and primary actions)
- Add explicit background/text when product confirms palette semantics

No custom fonts in v1 (ignore any future font fields). Footer always includes cre8ion Onda credit per target; `legalNotice` optional below/near footer with markdown subset noted in `LegalNoticePanel`.

---

### H. Suggested build sequence (for a later build prompt)

1. **Secret hygiene + public data access** (Admin SDK attendee loaders *or* credential split + rules) — **do first**
2. Types: `RoomDoc`, `ShowDoc.links`, `qrCodeUrl`, Contributor + `canDownloadQr`
3. Migration script: embed rooms → subcollection; dual-write helper in Admin room CRUD
4. Admin: Room edit + Session edit + Show links + publish toggle + branding light editor
5. QR API + Storage rules + download UI
6. Public pages: show → room → session → browse-all
7. Contributor role + layout/rules
8. Operator unlock: switch to Room docs or confirm dual-write; regression-test Electron
9. Indexes + slug uniqueness check
10. Cleanup: Admin copy `/portal` → `/show`; optional redirect

---

### I. Effort / complexity flags

| Item | Why it’s larger / riskier than it looks |
| --- | --- |
| **Public read vs `techCredential` on show doc** | Opening Firestore to anonymous readers without moving the credential leaks Operator unlock secrets. Server-mediated reads or a private subdoc are mandatory design work, not a one-line rules change. |
| **Room entity vs Operator unlock** | Phase 4 Electron/web unlock consumes `show.rooms[]`. Promoting rooms without dual-write or unlock update breaks Operator room select. |
| **Slug routing + uniqueness** | `portalURL` is not uniquely enforced; `/show/[slug]` needs a deterministic resolver and a publish-time uniqueness check. |
| **Session edit page** | Greenfield form + validation + room reassignment side effects; first time sessions are mutable after create. |
| **“Current live” on room page** | Needs correct timezone/day grouping, `isDraft` filtering, and either RTDB fan-in or Firestore `feedState` (Operator writes feedState to both — confirm attendee source of truth for highlight vs captions). Captions = RTDB; schedule highlight can use Firestore `feedState` if kept in sync. |
| **Contributor security** | Touching `BaseRole`, rules, admin gate, and UI — small role, wide blast radius. |
| **Branding schema drift** | Target names ≠ shipped fields; decide map-vs-rename before UI polish. |
| **PWA / offline** | Manifest + next-pwa exist; attendee UX may want installability later — don’t block v1, but QR→mobile traffic will stress mobile layout early. |
| **`portalPublished` never flipped** | Public pages need a publish story or everything stays unreachable / always open — product call. |

---

### J. Open questions (answer before build prompt)

1. **Attendee data loading:** Admin SDK server components (recommended) vs public Firestore rules? If rules, where does `techCredential` move?
2. **Publish gate:** Must `portalPublished === true` for `/show` and `/room`? Who can toggle it (`canEditShows` vs `canPublishSessions`)?
3. **Slug path:** Confirm `/show/{slug}` as canonical; keep `branding.portalURL` as the field; add `/portal/*` redirect?
4. **Show branding palette:** Map `primaryColor`/`secondaryColor` → accents and invent bg/text defaults, or extend `ShowBranding` with `backgroundColor` / `textColor` now?
5. **Room collection shape:** Subcollection `shows/{id}/rooms/{id}` vs top-level `rooms/{id}`?
6. **Dual-write duration:** Keep denormalized `ShowDoc.rooms[]` for Operator through Phase 5, or update unlock/Electron in the same release?
7. **QR persistence:** Always store in Storage + `qrCodeUrl`, or client-only download acceptable for v1?
8. **QR absolute origin:** Which env var / production host for encoded URLs (staging vs prod printed codes)?
9. **Session QR vs Room QR product priority:** Room is primary target — still generate Session QR on create/edit in the same slice?
10. **Contributor scope:** Download QR only, or also view schedule metadata in admin? Assigned-shows required?
11. **Legal notice on show home:** Include in Phase 5 footer work or defer?
12. **Timezone for day headers:** Event-local zone on Show (new field) vs browser local vs UTC?
13. **Draft sessions on `/show/.../sessions`:** Confirm always excluded (recommended).
14. **End-session attendee behavior** (`endSessionBehavior`, etc.): honor on `/session` in Phase 5 or leave standby/ended as simple non-live UI?

---

## Appendix — Key file references (current state)

| Area | Paths |
| --- | --- |
| Types | `types/index.ts` (`ShowDoc`, `ShowRoom`, `ShowBranding`, `SessionDoc`, `BaseRole`, `Capabilities`) |
| Rooms helpers | `lib/rooms.ts` |
| Permissions | `lib/permissions/roles.ts`, `lib/permissions/check.ts` |
| Admin shell | `app/admin/layout.tsx` |
| Show detail / rooms / sessions | `app/admin/shows/[showId]/ShowDetail.tsx`, `RoomsPanel.tsx`, `CreateSessionModal.tsx`, `LegalNoticePanel.tsx` |
| Users / overrides | `app/admin/users/CreateUserModal.tsx`, `UsersDashboard.tsx` |
| Operator unlock | `lib/tech/sessionLifecycle.ts`, `app/api/tech/unlock` |
| Middleware | `proxy.ts` |
| Rules | `firestore.rules`, `database.rules.json`, `storage.rules` |
| QR dep (unused) | `package.json` → `qrcode` |
| Prior audit style | `docs/audits/2026-07-29-show-transcription-style-operator-instructions.md` |
