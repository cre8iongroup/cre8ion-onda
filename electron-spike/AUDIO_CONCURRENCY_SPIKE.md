# Slice 2B — Audio concurrency spike (Mac runbook)

Isolated harness for Step 0 of Slice 2B. **Does not change the Stage 2A operator layout.**

## Open

1. From the operator UI: `⌘⇧D` → **Audio concurrency spike**, or
2. Set the window hash to `#audio-concurrency-spike` after launch.

## What it does

1. Starts a **getUserMedia + AnalyserNode** meter immediately (hardware tap, no session required).
2. Constraints intentionally disable echo cancellation / noise suppression / AGC so the meter
   prefers a shared HAL path instead of macOS Voice-Processing I/O (only one VPIO unit can run).
3. Lets you unlock a show, select a session, and call the real **Recall `startRecording`** path
   while the meter stays alive.
4. Logs meter snapshots before/after start and stop, plus main-process SDK / webhook events.
5. Checklist + **Export findings JSON** for paste-back into
   [`SLICE_2B_AUDIT_AND_PLAN.md`](./SLICE_2B_AUDIT_AND_PLAN.md).

## Mac protocol (required)

This cloud agent is Linux — the Recall Desktop SDK does not load here. Run on the Mac laptop:

```bash
# terminal 1 — Next with cre8ion-onda env
npm run dev

# terminal 2
cd electron-spike && npm install && npm start
```

Then:

| Step | Action | Pass criteria |
| --- | --- | --- |
| A | Open concurrency spike; speak into mic | Bar moves; updates/s ≈ 60; track `live` |
| B | Unlock → pick a disposable session → **Start Recall (meter stays up)** | `startRecording` resolves; no SDK `error` events |
| C | Speak for ~30–60s | Meter keeps updating (not stalled); transcripts / webhook OK lines appear |
| D | Listen to retrieved audio / check RTDB chunks | Capture sounds clean — no dropouts, no obvious ducking vs meter-only baseline |
| E | **Stop Recall (meter stays up)** | Recording ends; meter still updates across the boundary |
| F | Export JSON → paste into audit doc § Mac results | Checklist all PASS or failures noted |

### Guardrail variants (if Step C fails)

Re-run with the meter started **after** Recall is already recording, and/or flip
`echoCancellation: true` in `renderer-src/lib/inputMeterTap.js` to confirm whether VPIO contention
is the cause. Prefer keeping echoCancellation **off** for the production meter.

## Windows

Same harness later on the ThinkPad. Treat as an **open validation gap** — do not block Mac plan
review on Windows results.
