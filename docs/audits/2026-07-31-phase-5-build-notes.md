# Phase 5 build notes (implementation decisions)

## Accent colors

`ShowBranding.primaryColor` / `secondaryColor` are kept as the persisted accent
pair for backward compatibility with existing shows and Operator defaults.

`accentColors` (1–2 entries) is written in sync by the branding editor via
`syncAccentFields()` in `lib/branding.ts`. Effective attendee accents prefer
`accentColors` when non-empty; otherwise fall back to `[primaryColor, secondaryColor]`.

`backgroundColor` and `textColor` are distinct fields (not aliases of primary/secondary).

## Public app origin for QR

QR payloads use `NEXT_PUBLIC_APP_URL` (see `.env.example`). Fallback: `VERCEL_URL`,
then `http://localhost:3000`.

## Room dual-write

Canonical: `shows/{showId}/rooms/{roomId}`.
Denormalized: `ShowDoc.rooms[]` `{id,name}` for Operator unlock — do not remove
until Operator is updated in a later pass.

## Attendee data loading

Server-only Admin SDK helpers in `lib/attendee/load.ts` + public Route Handlers
under `/api/public/*`. Pages import helpers directly (still server-only; no client
Firestore for metadata). `techCredential` is never selected into public payloads.
`firestore.rules` were not loosened for anonymous read.
