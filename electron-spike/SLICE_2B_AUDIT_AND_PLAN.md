# Slice 2B — Audit findings + implementation plan

> **Superseded for planning.** The authoritative Slice 2B plan (RTDB auth answer +
> corrected `isDraft` / `feedState` model + conflicts) is in
> [`SLICE_2B_PLAN.md`](./SLICE_2B_PLAN.md).
>
> This file remains as the Step 0 concurrency audit / Mac spike record.

**Date:** 2026-07-28  
**Branch:** `cursor/slice-2b-audio-meter-spike-9d90`  
**Scope of this pass:** Step 0 concurrency spike + written plan only.  
**Not in this pass:** Production Slice 2B UI / lifecycle API changes.

---

## (a) Audit findings — getUserMedia meter × Recall capture

### Environment of this agent

| Fact | Detail |
| --- | --- |
| Host OS | Linux x86_64 cloud VM |
| Recall Desktop SDK | Native Mac/Windows only — does **not** load here (same constraint as `SPIKE_REPORT.md`) |
| Hardware mic | Not available for meaningful level metering |
| Live Mac concurrency result | **Not obtained in this pass** — requires Alex’s Mac laptop |
| Linux smoke | Electron launches; Firebase health fails without Next (expected); Recall SDK init skipped — **cannot** exercise overlap here |

### What was audited in code (no speculation about unoccupied routes)

| Area | Current state |
| --- | --- |
| Electron Stage 2A UI | `electron-spike/renderer-src/App.jsx` — unlock → session → start/stop; diagnostics ⌘⇧D |
| Recall start path | `main.js` `startRecording()` → `POST /api/tech/sessions/start` → create sdk_upload → `prepareDesktopAudioRecording` → `startRecording` |
| `startSession` side effects | Sets **both** `lifecycleStatus: 'live'` **and** `feedState: 'live'` (Firestore + RTDB) — **conflicts with Slice 2B “test capture” model** |
| `stopSession` | `lifecycleStatus: 'stopping'`, `feedState: 'paused'`; `ended` waits for upload-complete |
| Types | `FeedState = 'standby' \| 'live' \| 'paused' \| 'ended'` — **no `testing` yet** |
| Lifecycle values in code | `preproduction \| ready \| live \| stopping \| ended \| underReview \| approved \| published` — **not** `draft/ready/active/closed` |
| Existing web meter/device UI | `app/tech/components/AudioDevicePicker.tsx` — brief getUserMedia then **stops** tracks; in-app device picker (Slice 2B wants OS deep-link instead) |
| Network monitor (web) | `NetworkStatusMonitor.tsx` — browser online + RTDB `.info/connected` + latency; not webhook RTT |
| Electron webhook health signal | Already exists: `lastWebhookRttMs` / `lastWebhookOkAt` on transcript forward |
| Caption preview (web) | `PrivateTranscriptPreview.tsx` — RTDB `liveSessions/{id}/chunks`; **not gated on feedState** (correct precedent for operator preview) |
| Recall docs | Adhoc binds default mic+speaker at start; device change mid-recording can stop capture; **no** official statement forbidding concurrent getUserMedia |
| macOS Core Audio | Multiple consumers generally allowed in shared HAL mode; **Voice-Processing I/O (echo cancellation) is single-instance** — two clients fighting for VPIO is the main known conflict class |

### Spike delivered for Mac (run locally)

| Artifact | Purpose |
| --- | --- |
| `renderer-src/lib/inputMeterTap.js` | Continuous getUserMedia + AnalyserNode tap; echoCancellation/NS/AGC **off** by default |
| `renderer-src/AudioConcurrencySpike.jsx` | Isolated UI: meter from open → start/stop real Recall → checklist → export JSON |
| Hash route `#audio-concurrency-spike` + diagnostics link | Does not disturb Stage 2A layout |
| `AUDIO_CONCURRENCY_SPIKE.md` | Mac protocol + pass criteria |
| `main.js` | Also logs `speech_on` / `speech_off` (listener + realtime-event names) for capture-side activity |

### Provisional concurrency verdict (pending Mac paste-back)

**Provisional: proceed with getUserMedia meter as the Slice 2B approach, with guardrails — do not treat as Mac-signed-off.**

Rationale:

1. Recall does not expose level meters; renderer Web Audio is the only practical hardware-level readout.
2. Core Audio shared access normally allows multiple readers; the high-risk case is echo-cancellation / VPIO contention, which the spike disables on the meter side.
3. Electron already requests mic permission for Recall; a second renderer tap should not need a second user-facing permission prompt once granted.
4. Known product risk from Recall FAQ remains: **OS default device changes mid-recording can kill capture** — deep-linking to OS settings (not an in-app switcher) matches that constraint.

**Hard blockers to shipping the meter into the live record screen without Mac results:** none for *planning*, but Mac checklist must be green before calling Slice 2B “verified on hardware.”

### Mac results (fill after laptop run)

```
Date / machine:
macOS version:
Mic device:
Checklist:
  [ ] meter alone
  [ ] meter during Recall
  [ ] transcripts clean during overlap
  [ ] no SDK errors
  [ ] meter survives stop
Exported JSON verdict:
Notes (dropouts, AGC ducking, permission prompts):
```

### Open validation gap — Windows ThinkPad

Same concurrency spike must be re-run on Windows WASAPI later. Shared-mode capture usually works; exclusive-mode devices and some Bluetooth headsets are the risk. **Does not block Mac plan review.**

---

## (b) Implementation plan — rest of Slice 2B

### Critical Phase 5 gating note (do not lose)

> **Whoever builds the Attendee PWA and Output view (Phase 5) MUST gate attendee/output visibility on `feedState === 'live'`, never on “does transcript / audio data exist for this session.”**
>
> During operator **testing**, real Recall audio and transcript chunks flow into storage and RTDB the entire time. If Phase 5 keys off data presence, **test noise leaks to attendees**.
>
> Operator live-caption preview in Electron **must not** use that gate — operators need to see transcripts during `testing`.

---

### B0. Decide lifecycle / feedState vocabulary before coding

**Mismatch to resolve with product (blocking for API work):**

| Concept | Spec language in this brief | Code / Firestore today |
| --- | --- | --- |
| Lifecycle | `draft / ready / active / closed` | `preproduction / ready / live / stopping / ended / underReview / approved / published` |
| Feed | `standby → testing → live → ended` | `standby / live / paused / ended` (no `testing`) |
| Start test | lifecycle → active, feed → testing | `startSession` sets **both** to `live` |
| Go Live | feed → live only | Web `GoLiveControl` can set feed; Electron start already forced feed live |
| End | lifecycle → closed, feed → ended | stop → `stopping` + `paused`; upload-complete → `ended` |

**Recommendation (needs your sign-off):**

1. **Keep Firestore lifecycle enum as-is** for Admin/review/publish (`preproduction…published`). Map operator-facing labels: e.g. show `Status: Live` while recording (today’s `live`), do **not** rename to `active/closed` in storage unless Admin is rewritten.
2. **Add `testing` to `FeedState`** (types, RTDB rules if needed, Admin badges).
3. Change start API: `lifecycleStatus → live` (recording genuinely running), `feedState → testing` (not visible to attendees).
4. New **Go Live** API/IPC: `feedState → live` only; **do not** stop/restart Recall.
5. End session: keep **stopping** intermediate for upload safety unless you explicitly want to drop it; display can still say “Ended” once `ended`. Clarify whether `paused` remains during stopping or feed jumps `testing|live → ended` immediately on stop click.
6. **No “stop test / reset” path** — one continuous take from test through live to end.

**Needs input:** Confirm recommendation vs literally renaming lifecycle to draft/ready/active/closed.

---

### B1. Audio input meter

| Item | Plan |
| --- | --- |
| Source | Promote `inputMeterTap.js` into a small hook/component used by the operator shell |
| UI | Single 0–100 horizontal bar (not segmented), always visible after app open / unlock shell — **independent of session selection and feedState** |
| Lifecycle | Start on renderer mount (or post-mic-permission); never stop on session change / Go Live / End |
| Constraints | `echoCancellation: false`, NS/AGC false (pending Mac confirmation) |
| Failure UX | Permission denied / stalled → red bar + short “Mic unavailable — open Sound settings” |
| If Mac concurrency FAIL | Fallback options (pick one after results): (1) pause meter while Recall recording, resume after stop; (2) use Recall `speech_on/off` as binary activity only (no level); (3) native helper. Prefer (1) over removing pre-flight metering entirely |

**Risks / needs input:** Acceptable to show 0 while silent? Peak-hold marker or pure RMS bar only?

---

### B2. Audio output

| Item | Plan |
| --- | --- |
| Display | `enumerateDevices()` → default `audiooutput` label (refresh on `devicechange`) |
| Test tone | Short oscillator beep via Web Audio → `setSinkId` when available; else default output |
| No | Passive output level meter (explicitly out of scope) |

**Risks:** Electron `setSinkId` support varies; may only exercise default device — still useful as “can I hear this laptop.”

---

### B3. Device switching (input + output)

| Item | Plan |
| --- | --- |
| UI | Buttons: “Open Sound Settings” — **no in-app device pickers** (retire/ignore web `AudioDevicePicker` pattern in Electron) |
| macOS | `shell.openExternal('x-apple.systempreferences:com.apple.preference.sound')` or `open -b com.apple.systempreferences` / Sequoia Settings URL — verify on target OS version |
| Windows | `ms-settings:sound` via `shell.openExternal` |
| Main process | New IPC `spike:open-os-settings` `{ target: 'sound' \| 'network' }` |

**Risks / needs input:** Exact macOS Settings deep-link differs by version (Ventura System Settings vs older). Confirm target Mac OS for operator laptops.

**Recall constraint:** Changing default device mid-recording may stop capture — copy should warn if `recording === true`.

---

### B4. Network health

| Item | Plan |
| --- | --- |
| Indicator | R/Y/G from Electron webhook round-trip health (`lastWebhookRttMs` + age of `lastWebhookOkAt`), with fallback to RTDB `.info/connected` / navigator.onLine when no transcripts yet |
| Thresholds (proposed) | Green: last OK &lt; 15s ago and RTT &lt; 800ms · Yellow: OK &lt; 45s or RTT 800–2000ms · Red: offline, forward failures, or stale &gt; 45s while recording/testing |
| Network name | Main-process helper: macOS `networksetup -getairportnetwork en0` (or SCDynamicStore); Windows `netsh wlan show interfaces` — display SSID or “Wired / unknown” |
| Settings | Deep-link OS network settings (`x-apple.systempreferences:com.apple.preference.network` / `ms-settings:network`) — no in-app Wi‑Fi picker |

**Risks / needs input:** Approve R/Y/G thresholds. Pre-recording (no webhooks yet) — show connectivity-only green/yellow, not “red because no RTT.”

---

### B5. Live caption preview

| Item | Plan |
| --- | --- |
| Data | Electron renderer subscribes to RTDB `liveSessions/{sessionId}/chunks` (same path Attendee/Output will read) |
| Auth | Needs Firebase client auth or a restricted RTDB read path for the tech credential session — **audit before build**: today Electron never talks to RTDB directly (API + webhook only). Options: (1) sign in tech user after unlock via custom token API; (2) poll a small Next proxy; (3) mirror last N lines over IPC from main if main gains Admin. Prefer (1) if tech Auth user already provisioned per show |
| Gating | **Show during `testing` and `live`** — do not require `feedState === 'live'` |
| Layout | Large 16:9 pane left |

**Needs input:** Preferred RTDB auth approach for Electron (custom token vs proxy).

---

### B6. Status badges

| Item | Plan |
| --- | --- |
| Replace | Ambiguous dual “Ended” / capture badge pairing |
| Show | `Status: [lifecycleStatus]` and `Feed: [feedState]` as two explicit badges |
| `testing` | Distinct visible token (e.g. amber “Testing”) — not muted like ended |
| Mapping | Display labels only until B0 vocabulary decision lands |

---

### B7. Operator actions / lifecycle wiring

| Action | Recall | Firestore lifecycle | feedState |
| --- | --- | --- | --- |
| Start test capture | Real `startRecording()` | → `live` (recording running) | → `testing` |
| Go Live | No SDK call | unchanged | → `live` |
| End session | `stopRecording()` + existing upload/ended path | → `stopping` then `ended` (unless B0 changes) | → `ended` (clarify vs intermediate `paused`) |

API deltas:

- Extend `POST /api/tech/sessions/start` (or rename) for testing semantics.
- Add `POST /api/tech/sessions/go-live` (feed only).
- Keep stop/ended path; remove any implication that start = attendee-visible.

**No reset / stop-test.** Dead air between test and Go Live is accepted.

---

### B8. Layout (match approved mockup)

```
┌──────────────────────────────────────────────────────────┐
│ Header: brand · show · session picker                    │
├────────────────────────────┬─────────────────────────────┤
│                            │ Input meter (0–100 bar)     │
│  Live caption preview      │ Output device + test tone   │
│  (large 16:9)              │ Network health + SSID       │
│                            │ Status + Feed badges        │
├────────────────────────────┴─────────────────────────────┤
│ End session                                              │
└──────────────────────────────────────────────────────────┘
```

Controls: Start test / Go Live (enabled by state) live near badges or below grid per mockup; End below grid.

**Needs input:** Mockup file was not in repo — confirm CTA placement (header vs under grid) from the approved comp before pixel work.

---

### B9. Suggested build order (after plan sign-off)

1. Mac concurrency checklist paste-back → lock meter approach / guardrails  
2. Types + `start` / `go-live` / stop feedState semantics (B0 decisions)  
3. Meter + output + OS settings IPC (hardware panel)  
4. Network health + SSID  
5. Caption preview auth + RTDB subscribe  
6. Badge copy + 16:9 layout composition  
7. Mac hardware pass on full Slice 2B screen; Windows gap noted  

---

### Explicit non-goals (this plan)

- Attendee PWA / Output view (Phase 5) — **except** documenting the `feedState === 'live'` gate  
- In-app mic/speaker/Wi‑Fi pickers  
- Passive output metering / OS loopback  
- Stop-test / reset / multi-take restart logic  
- Full Slice 2B implementation in this PR  

---

### Decision checklist for review meeting

1. Lifecycle storage: keep `live/stopping/ended/…` or rename to `active/closed`?  
2. On End click: feed goes straight to `ended`, or keep `paused` while `stopping`?  
3. Electron RTDB caption auth approach?  
4. Network R/Y/G thresholds OK?  
5. macOS version for Settings deep-links?  
6. Mac concurrency JSON results (block hardware “done,” not plan review)?  
