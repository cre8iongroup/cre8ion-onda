# Review workflow

The Reviewer panel manages post-event content review and publishing. It is separate from the live show system (`feedState`, Tech Operator, Attendee captions).

## Review states

Each session has a `reviewState.status` value. These are labels, not a required sequence — a reviewer may jump directly to any state.

| Status | Meaning |
|--------|---------|
| **Needs review** | Default when a session is created. Content is waiting for review. |
| **In review** | Someone is actively reviewing this session. |
| **Approved** | Review complete and ready internally — **does not** publish a public URL. |
| **Published** | Creates a public notes page at `/summary/{showId}/{sessionId}`. Independent of the show's live attendee portal (`portalPublished`). |

**Unpublish:** Set status back to **Approved** to remove the session from the public summary route.

## Consent gate

Publishing is blocked when `aiNotesConsent === false` on the session document. The Reviewer UI shows a specific message when this applies. Consent is set manually in Firestore for now (no Admin UI in this phase).

## What reviewers see

- Assigned shows only — reviewers must have explicit `assignedShows`; empty means no access.
- Full Firestore transcript, parsed AI summary, audio download, content-health checks, and PDF export (summary + full transcript).
- Regenerate Summary is not available yet — when it ships, re-approval will reset approved/published sessions to **Needs review**.
