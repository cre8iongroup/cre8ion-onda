# Spike report: Electron + Recall Desktop SDK (adhoc / in-person)

**Date:** 2026-07-20  
**Branch:** `cursor/spike-electron-recall-adhoc-03f0`  
**Environment of this agent:** Linux x86_64 cloud VM (not macOS)

## Verdict

| Step | Status on this agent | Status expected on Mac + keys |
| --- | --- | --- |
| Mic → SDK capture | **Not runnable** (Linux; SDK is Mac/Windows native) | Should work via `prepareDesktopAudioRecording` + `startRecording` |
| Webhook receives data | **Code ready**; live POST needs `RECALL_WEBHOOK_SECRET` + Admin SDK | Electron forwarder posts Onda-shaped JSON with `x-recall-secret` |
| RTDB transcript chunks | Same as webhook (Admin write) | Same path as Phase 4 `liveSessions/{sessionId}/chunks` |
| Retrieve full audio | **Code ready** (poll Retrieve Recording + download) | Needs live `recording_id` after upload completes |
| Full loop e2e | **Not proven here** | Must be signed off on a Mac laptop |

**Bottom line:** The spike scaffolding and webhook adapter are in place. The full mic→RTDB→downloadable audio loop **cannot be claimed working** until someone runs `electron-spike` on Apple Silicon with Recall + Firebase Admin secrets.

## What was built

1. **`electron-spike/`** — minimal Electron window (Start / Stop + log)
   - Adhoc path only (no `meeting-detected`)
   - Creates SDK upload with `audio_mixed_mp3`, `video_mixed_mp4: null`, `recallai_streaming`
   - Forwards `transcript.data` → Onda webhook
   - After stop, polls Retrieve Recording and saves MP3 under `downloads/`
2. **Webhook adapter** — `app/api/recall/webhook` + `functions/src/recallWebhook.ts`
   - Still accepts Phase 4 custom payload
   - Also accepts native Recall `transcript.data` when `?sessionId=` is set
3. **Helpers** — `POST /api/recall/sdk-upload`, `GET /api/recall/recordings/[recordingId]`
4. **Offline normalize test** — `electron-spike/scripts/verify-normalize.js`

## Phase 4 webhook: worked as-is?

**Not for native Recall payloads.** Phase 4 assumed:

```json
{ "sessionId", "text", "speaker", "timestamp", "isFinal" }
```

plus header `x-recall-secret`.

Recall’s realtime `transcript.data` is a nested envelope (`event` + `data.data.words[]`).  
**Required change:** normalize in Electron (preferred — preserves secret) **and** teach the webhook/CF to accept the native shape. Both are in this PR.

Also: Recall’s `type: "webhook"` realtime endpoint does **not** send `x-recall-secret`. Prefer the Electron forwarder for auth. If using a public webhook URL from Recall, you’d need a different auth story (IP allowlist / signed URL / separate secret query param).

## Permissions (what to record on Mac first run)

Documented expectation from Recall:

- Meeting mode guidance: `microphone`, `accessibility`, `screen-capture`
- Adhoc: mic is essential; this spike still requests all three and logs results

**Not observed on this agent** (no macOS UI). On first Mac run, note:

1. Exact wording of the mic prompt (Electron vs system Settings)
2. Whether Screen Recording / Accessibility sheets also appear for adhoc
3. Whether recording works with **mic only** if the others are denied

## Latency

Not measured here. The Electron log records:

- Time when `realtime-event` arrives (SDK → app)
- Webhook RTT (`lastWebhookRttMs`)

Rough speak→RTDB latency ≈ SDK transcript delay + webhook RTT. Expect **low hundreds of ms to a few seconds** with `prioritize_low_latency`; fill in real numbers from a Mac test.

## Gotchas / surprises (from docs + code audit)

1. **Adhoc speaker labels** are Host/Guest only (mic vs other); no meeting participant names. Diarization needs provider flags + `transcript.provider_data`.
2. **Device changes mid-recording** can stop capture (Recall FAQ).
3. **`recording_id` on webhook realtime events** may be zero UUID — pass `sessionId` as query param (docs). Create-upload response still returns `recording_id` for Retrieve Recording.
4. **Auth header** for Recall REST: `Authorization: Token <api_key>` (used in helpers).
5. **Linux / CI** cannot load the native SDK meaningfully — treat Mac as the gate.
6. **Secrets missing** in this cloud `.env.local` (only `NEXT_PUBLIC_FIREBASE_*`) — no live Recall or Admin ADC to complete e2e here.
7. **`onTranscriptChunk`** only processes **finalized** chunks — forwarding `isFinal: true` for `transcript.data` (and skipping or marking partials) matters for translation pipeline.

## Windows

Easy to try later: same Electron app, skip macOS permission helpers. **Defer** until Mac loop is green — no code fork required beyond smoke testing.

## How to finish verification (Mac checklist)

1. Add secrets to root `.env.local` and `electron-spike/.env`
2. `npm run dev` + create/use a real `SESSION_ID` in RTDB rules scope
3. `cd electron-spike && npm install && npm start`
4. Allow mic (and note other prompts)
5. Start → speak → confirm log lines + RTDB `liveSessions/{id}/chunks`
6. Stop → confirm file in `electron-spike/downloads/`
7. Paste latency + permission notes back into this report

## Explicit non-goals (unchanged)

No notarization, no Tech Panel integration, no Windows sign-off in this PR.
