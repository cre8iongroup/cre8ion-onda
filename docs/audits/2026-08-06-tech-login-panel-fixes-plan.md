# Plan: Tech Login + Tech Panel fixes

**Status:** Investigation / proposal only — no implementation in this pass.  
**Date:** 2026-08-06  
**Audience:** Alex + team  
**Scope:** (1) credential-only `/tech/login`, (2) admin↔tech auth collision, (3) room-scoped Output Builder chrome.

---

## Verdict (short)

1. **`/api/tech/unlock` is a plain Firestore equality lookup** on `shows.techCredential` — no hash. Credential-only web login can reuse that, then derive `tech+{portalURL}@onda.tech` under the hood. **But** the live “Invalid show code or tech credential” failure with a correct slug+credential is almost certainly **Auth password drift**, not a wrong slug: when Admin re-saves a credential and the Auth user already exists, `provisionTechAuthUser` returns `{ existed: true }` and **does not rotate the Auth password**. Fixing login UX without fixing that sync will still fail.
2. **Admin/tech “collision” is expected single-Firebase-session behavior**, amplified by a real UX/logic bug: admins have `canAccessTechPanel: true`, so `/tech/*` admits them without Tech login; admins usually have `assignedShows: []` (“all shows”), and Tech pages treat empty as “not assigned to a show.”
3. **Room context** is missing in the Builder header/shell; nav highlighting for `/tech/output` is fine by pathname, but deep-linked `?roomId=` without a resolvable `showId` never loads the room — so Tech never sees room confirmation.

---

## 1. Credential-only login (match Operator unlock)

### How `/api/tech/unlock` resolves a show today

`POST /api/tech/unlock` → `unlockShowByCredential(credential)` in `lib/tech/sessionLifecycle.ts`:

```ts
firestore.collection('shows')
  .where('techCredential', '==', trimmed)
  .limit(2)
  .get()
```

- **Direct equality** on the plaintext `techCredential` field (Admin SDK). Not a hash.
- 0 matches → `401 invalid_credential`
- 2+ matches → `409 ambiguous_credential`
- 1 match → returns show DTO including `portalURL: show.branding.portalURL`, rooms, sessions

Electron never uses Firebase Auth for unlock.

### How `/tech/login` works today (and why it fails)

Client-only:

1. User types **portal slug** + **credential**
2. `signInWithEmailAndPassword(auth, tech+{slug}@onda.tech, credential)`
3. Sets `onda-session` cookie; redirects to `?from=`

Admin UI shows “Show code” = `branding.portalURL` (`TechCredentialPanel`) — same string the login form expects as slug. So a correct Overview slug + current show credential **should** work **if** the Auth user’s password still equals `techCredential`.

**Known provision gap** (`lib/tech/provisionTechUser.ts`):

- First save: creates Auth user with password = credential + `users/{uid}` (`baseRole: 'tech'`, `assignedShows: [showId]`).
- Later save when email already exists: **returns `{ existed: true }` and does not update Auth password.** Firestore `techCredential` is updated via `/api/admin/shows/tech-settings`, but Auth stays on the old password.

That matches live testing: Operator unlock (Firestore field) works; web login (Auth password) fails with the same credential.

There is **no** `createCustomToken` / `signInWithCustomToken` usage in the repo today. `getAdminAuth()` exists in `lib/firebase/admin.ts`.

### Can Auth email still work without the user typing the slug?

**Yes**, with this flow:

1. New (or extended) API: credential → same `unlockShowByCredential` lookup.
2. Read `show.branding.portalURL` → build `tech+{portalURL}@onda.tech`.
3. Ensure Auth user exists **and password matches credential** (see sync fix below).
4. Either:
   - **A (minimal):** API returns `{ email }` only; client `signInWithEmailAndPassword(email, credential)` after `signOut()` of any prior session; or
   - **B (preferred):** API issues Admin `createCustomToken(uid)` after verifying credential + syncing password; client `signInWithCustomToken(token)`. Credential never needs to equal Auth password long-term if we always mint tokens after Firestore check — but we should still keep password in sync for any leftover client password paths.

**Recommendation:** **B + password re-sync on every successful credential web login / credential save**, so Operator and web stay aligned and the `existed: true` trap is closed.

### Proposed implementation (issue 1) — for approval

| Step | Change |
|---|---|
| 1 | Add `POST /api/tech/web-login` `{ credential }` → reuse `unlockShowByCredential`; resolve portal slug from `branding.portalURL`; ensure Auth user (`getUserByEmail` / create); **`updateUser({ password: credential })`**; `createCustomToken(uid)`; return `{ token, show: { id, name, portalURL } }`. |
| 2 | Rewrite `/tech/login` to a **single credential field**; call web-login API; `signOut()` if someone else is signed in; `signInWithCustomToken`; set cookie; redirect to `from`. |
| 3 | Fix Admin `provisionTechAuthUser` / tech-settings path: when Auth user exists, **rotate password** via Admin SDK (not client Identity Toolkit alone), so future password-based paths don’t drift. |
| 4 | Remove slug field + copy; keep `techEmailForPortalSlug` as internal helper. |
| 5 | Preserve `?from=/tech/output?roomId=…` return path (URL-encode carefully). |

**Out of scope unless requested:** changing Operator unlock; hashing `techCredential` at rest.

---

## 2. Admin / Tech session collision

### What’s actually happening

| Fact | Evidence |
|---|---|
| One Firebase Auth client for the whole app | Root `app/layout.tsx` wraps everything in a single `AuthProvider` → `getClientAuth()` singleton |
| Only one signed-in user at a time | Firebase Auth design; signing in as Tech replaces Admin in that browser profile |
| Admin is allowed into `/tech/*` without Tech login | `admin.canAccessTechPanel === true`; tech layout only checks that capability, not `baseRole === 'tech'` |
| “Not assigned to a show” on admin | Tech Sessions / Builder use `assignedShows[0]`; admin docs typically have `assignedShows: []` meaning “all shows” elsewhere, but Tech treats empty as none |

So this is **not** two identities racing inside one page. It is: **Admin session is reused for Tech routes**, then Tech pages mis-handle admin’s empty `assignedShows`.

Reproduction fit: signed in as `alex@…` → open `/tech/output?roomId=…` → layout admits admin → Builder never gets `showId` from `assignedShows[0]` and (today) does not resolve show from `roomId` alone → warning copy that sounds like a Tech account problem.

### Options (recommend A+C)

| Option | Behavior | Pros / cons |
|---|---|---|
| **A. Soft gate (recommended UX)** | If `user` exists and `baseRole !== 'tech'`, Tech layout (non-login) shows a clear panel: “You’re signed in as {email} (admin). Sign out to enter with a Tech credential.” CTA → sign out → `/tech/login?from=…`. Do **not** silently evaluate Builder against admin. | Matches product intent; no surprise; keeps admin from half-using Tech |
| **B. Hard redirect** | Non-tech roles always redirected to `/tech/login` even if already signed in | Simpler but login page must force switch; confusing if login doesn’t explain why |
| **C. Deep-link show resolution** | When `?roomId=` present, resolve owning `showId` (Admin SDK API or client scan of assigned/accessible shows) so a *legitimate* tech (or future admin-override) can open Builder without relying on `assignedShows[0]` | Needed for room links either way |
| **D. Let admin use Builder fully** | Empty `assignedShows` → show picker / resolve room’s show | Useful for Alex debugging, but conflicts with “Tech credential” product model if left as silent default |

**Recommendation:** **A + C**. Admins must explicitly switch to Tech credential for `/tech/*` work. Separately, room deep links resolve `showId` from `roomId` once a real tech session is active.

Login page interaction with #1: credential submit always `signOut()` then custom-token sign-in as the tech user, so an open Admin tab in the **same** browser profile will become Tech after login (expected). Document: use a separate browser profile / window if you need Admin + Tech simultaneously.

---

## 3. Room-scoped Tech chrome

### Current state

- `/tech/output?roomId=` can set `roomId` state, but **show resolution depends on `assignedShows` / `showId` query** — broken for admin and fragile for tech if `roomId` is alone.
- Page title is generic “Output Builder”; room name only appears inside a `<select>` once loaded.
- Tech nav: Sessions / Output / Network — pathname `/tech/output` correctly marks Output active. If Tech lands on `/tech` (e.g. bad `from` or manual nav), Sessions is emphasized — that matches the complaint when deep-link setup fails and they bounce around.
- No “Change room” / back-to-room-picker control beyond the select.

### Proposed UX (issue 3)

1. **Header when room selected:**  
   `Output Builder — {roomName}`  
   Subline: show name. Never ambiguous.
2. **While `roomId` in URL but still loading:** skeleton / “Loading {roomId}…” rather than Sessions-looking empty state.
3. **“Change room”** control clears `roomId` from the URL and returns to the room picker on the same Output page (not Sessions).
4. **Deep link:** `?roomId=` → resolve show + room; if room not found, explicit error on Output page.
5. **Login `from`:** ensure `/tech/login?from=` preserves full `/tech/output?roomId=…` (encode). After #1 login, land directly on Builder with room context — not `/tech` Sessions.
6. **Nav:** leave Sessions in the shell; do not auto-navigate room-scoped visits to Sessions. Optional: when `roomId` is present, sidebar subtitle shows the room name.

Optional later: filter Sessions list by room when `roomId` is in context — **not required** for this pass if Output deep links never dump Tech onto Sessions.

---

## Suggested implementation order

1. **Auth foundation:** web-login API + password re-sync on provision/login + credential-only login UI (#1).  
2. **Tech layout soft gate** for non-`tech` roles (#2A).  
3. **Builder room context** header, Change room, `roomId`→show resolution (#3 + #2C).  

Ship as one PR if small, or two: (auth) then (panel chrome).

---

## Confirmations requested before coding

1. Soft-gate admins out of Tech (sign out → credential login) vs. allow admin to use Builder with a show/room picker?
2. Custom token web-login (**B**) vs. derive-email + `signInWithEmailAndPassword` (**A**), given we must fix password sync either way?
3. OK to rotate Auth password via Admin SDK whenever tech credential is saved or web-login succeeds?
4. Room header copy: `Output Builder — {roomName}` acceptable?
5. Preserve Sessions nav item globally (yes per your note)?

---

## File index (investigation)

| Area | Paths |
|---|---|
| Unlock | `app/api/tech/unlock/route.ts`, `unlockShowByCredential` in `lib/tech/sessionLifecycle.ts` |
| Web login | `app/tech/login/page.tsx`, `lib/tech/credentials.ts`, `lib/tech/provisionTechUser.ts` |
| Auth singleton | `app/layout.tsx`, `context/AuthContext.tsx`, `lib/firebase/client.ts` |
| Tech gate | `app/tech/layout.tsx`, `lib/permissions/roles.ts` (`canAccessTechPanel`) |
| Assigned-show bug | `app/tech/page.tsx`, `app/tech/output/OutputBuilderClient.tsx` |
| Admin SDK Auth | `lib/firebase/admin.ts` (`getAdminAuth`) |
