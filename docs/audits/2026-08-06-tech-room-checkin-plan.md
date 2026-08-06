# Plan: Reconcile web Tech Panel with Operator room check-in

**Status:** Investigation / proposal only — no implementation in this pass.  
**Date:** 2026-08-06  
**Audience:** Alex + team  
**Depends on:** Working credential-only `/tech/login` (PR #76).

---

## Verdict (short)

Onda Operator’s real flow is **credential unlock → room check-in → room-scoped sessions → operate**. The web Tech Panel still reflects **Phase 1–4 scaffolding**: a flat sidebar (Sessions + Network from day one; Output bolted on in Phase C) and an **unscoped show-wide Sessions list** as the post-login landing page. That does not match Operator and was never the Output Builder product intent.

Recommended direction: after web login, land on a **room check-in screen**; once checked in, treat **Output Builder for that room** as the primary surface, with **Change room** mirroring Operator. Defer or demote unscoped Sessions / Network rather than rebuilding Operator’s full capture console in the browser.

---

## 1. How Operator implements room check-in

**Source of truth:** `electron-spike/renderer-src/App.jsx` (screen state machine). No URL routing — in-memory `screen` + React state. **No localStorage/sessionStorage** for room persistence; check-in is per Operator run.

### Screen flow

```
unlock  →  rooms  →  sessions  →  record
  ↑          ↑          │           │
  └──────────┴── Change room / Back ┘
```

| Screen | Purpose | Key UI |
|---|---|---|
| `unlock` | Shared show credential (same secret as web login) | Single password field → `spike.unlock` → `POST /api/tech/unlock` |
| `rooms` | **Room check-in** | “Select a room” list; each card = room name + session count; Back → unlock |
| `sessions` | Sessions **in the checked-in room only** | Header kicker = `{roomName} · {showName}`; **Change room**; list filtered by `roomId` |
| `record` | Live operate (sound check / go live / captions / meter / network / instructions) | Room name under session title; **‹ Sessions** back (stays in room) |

### Data flow after unlock

1. Unlock returns `{ show, rooms, sessions, credential }` (Firestore `techCredential` lookup — no Auth).
2. React state: `credential`, `show`, `rooms[]`, `sessions[]`, `selectedRoomId`, `selectedSessionId`, `screen`.
3. `handleSelectRoom(roomId)` → `setSelectedRoomId` → `setScreen('sessions')`.
4. `roomSessions = sessions.filter(s => s.roomId === selectedRoomId)` — **room is the scope**.
5. Selecting a session calls `spike.selectSession(...)` (IPC / main process context) → `screen = 'record'`.

### Leave / switch room

| Action | Behavior |
|---|---|
| **Change room** (`handleChangeRoom`) | Clears session IPC context; clears `selectedRoomId` / session UI state; back to `rooms`. **Blocked while capturing** (`feedState !== 'ended'`). |
| **‹ Sessions** (`handleBackToSessionList`) | Clears session only; **stays in room** → `sessions` screen. |
| **Back** on rooms (`handleBackUnlock`) | Full unlock reset (credential/show wiped). |

Room check-in is **explicit and sticky for the Operator session**, not a query param and not restored across app restarts.

### Code references

- Unlock → rooms: `handleUnlock` ~L524–547 (`setScreen('rooms')`)
- Room pick: `handleSelectRoom` ~L550–555; UI ~L794–847
- Room-scoped list: `roomSessions` ~L507–512; UI ~L849–901
- Change room: `handleChangeRoom` ~L614–630
- Record room label: `recordRoomName` ~L718, ~L921

---

## 2. Origin of web Tech Panel nav items

Defined in `app/tech/layout.tsx` as `TECH_NAV`.

| Nav item | Route | Origin | What it does today |
|---|---|---|---|
| **Sessions** | `/tech` | **Phase 1+2 scaffold** (commit `0c40af4`, Jun 2026) — present from the first Tech shell. Filled in **Phase 4** (`e111bd9`) as a show-wide session list + `/tech/sessions/[sessionId]` operator-ish page (device picker, Go Live, private preview, network). That web operator path is already marked outdated (“use Onda Operator”) in `GoLiveControl`. | Unscoped (or admin-picked show) session list for today/tomorrow; **not** room-filtered. |
| **Network** | `/tech/network` | Same Phase 1–2 scaffold + Phase 4 page wrapping `NetworkStatusMonitor` (browser online, RTDB `.info/connected`, latency). | Station connectivity diagnostics; **no room or session scope**. |
| **Output** | `/tech/output` | Added in **Output Builder Phase C** (commits `a0db9c8` / `1555568`, Aug 2026) as a third flat sibling — not a redesign of the shell around room check-in. | Output Builder (room config + open windows). Deep link `?roomId=` exists but landing after login is still `/tech` (Sessions). |

**Conclusion:** Sessions + Network are **leftover Phase 4 web-operator scaffolding**, predating Output Builder. Output was **appended** to that shell during Phase C for convenience (`/tech` auth + deep links), not because the product asked for a three-item flat IA. The shell never learned Operator’s room-first model.

---

## 3. Proposed reconciliation (for review — not implementing yet)

### Principles

1. **Match Operator’s mental model:** credential → **check into a room** → work in that room.
2. **Web Tech Panel’s job for this pass is Output**, not replacing Electron capture / Go Live.
3. Keep deep links (`/tech/output?roomId=…` from operatorInstructions) working: treat as **already checked into that room**.

### Landing after login

| Step | Web behavior |
|---|---|
| Post `/tech/login` | Redirect to **`/tech` = room check-in** (not Sessions list). |
| Room check-in UI | Mirror Operator: show name kicker, “Select a room”, room cards (name + optional session count), empty state if no rooms. |
| Pick room | Persist check-in (see storage below) → navigate to **`/tech/output?roomId={id}&showId={id}`** (Output Builder as home for that room). |

### Once checked in

| Element | Proposal |
|---|---|
| **Primary surface** | Output Builder for the checked-in room (`Output Builder — {roomName}` already exists). |
| **Shell chrome** | Show **checked-in room name** in sidebar (or header); **Change room** control (→ clear check-in → room picker). |
| **Sidebar nav** | **Remove or hide** flat Sessions / Network / Output triad as the top-level IA. Prefer: room context + single primary “Output” (or no secondary nav at all for v1). |
| **Sessions (web)** | **Defer** as a room-scoped list inside the room (Operator-parity) — **out of scope for this pass** unless you want a minimal “sessions in this room” read-only list. Do **not** keep the current show-wide Sessions landing. |
| **Network (web)** | **Defer / hide** for this pass. Operator already embeds network on the record screen; web Network page is scaffolding with no room scope. Revisit if Tech needs browser-side diagnostics without Electron. |
| **Legacy `/tech/sessions/[id]`** | Leave behind an “outdated — use Operator” banner or redirect to room Output; no investment. |

### Change room (align with Operator)

- Clear checked-in `roomId` (and related query params).
- Return to room picker.
- No capture-blocking needed on web (web isn’t running Recall) — always allow Change room.
- Deep-linked entry with `?roomId=` counts as checked-in; Change room still available.

### How to carry room context (web)

Recommend **URL as source of truth** + light client cache:

- Canonical in-room URL: `/tech/output?roomId=&showId=`
- Optional `sessionStorage` key (e.g. `onda.tech.checkedInRoom`) so `/tech` can redirect back into the room if Tech hits the root mid-shift — clear on Change room / sign-out.
- Do **not** use localStorage for multi-day sticky check-in (Operator doesn’t either).

Admin on Tech panel: keep show picker **before** room check-in when `assignedShows` is empty (already needed); then same room flow.

### Suggested implementation phases (after approval)

1. **Room check-in landing** at `/tech` (replace Sessions list UI).
2. **Post-check-in routing** → Output Builder with room context; sidebar shows room + Change room; demote/remove Sessions & Network from `TECH_NAV`.
3. **Deep link + sessionStorage** glue; sign-out clears check-in.
4. (Optional later) Room-scoped sessions list; Network as a room-context utility.

---

## Confirmations requested before coding

1. After room check-in, is **Output Builder the only primary web surface** for now (Sessions/Network hidden)?
2. OK to **replace** `/tech` Sessions list with the room picker (Sessions list not preserved as landing)?
3. **sessionStorage** for mid-shift sticky check-in OK, or URL-only?
4. Admin path: show picker → room picker → Output — confirm.
5. Any need to keep Network reachable (e.g. footer link) in this pass?
