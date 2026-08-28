'use client'

import { useState } from 'react'
import { parseAiSummary } from '@/lib/review/parseAiSummary'
import { getSummarizeEligibility } from '@/lib/review/transcriptSummarize'
import { callSummarizeSession, SummarizeSessionError } from '@/lib/review/summarizeSession'
import { userFacingError } from '@/lib/review/userFacingError'
import type { ReviewState, TranscriptChunk, WithId } from '@/types'

const PUBLISHED_CONFIRM_MESSAGE =
  'This session is published — regenerating will immediately change the live public page. This does not change its review status. Continue?'

type Props = {
  showId: string
  sessionId: string
  reviewState: ReviewState
  aiSummary: string | undefined
  chunks: WithId<TranscriptChunk>[]
  canGenerate: boolean
}

export default function AiSummaryGenerateControls({
  showId,
  sessionId,
  reviewState,
  aiSummary,
  chunks,
  canGenerate,
}: Props) {
  const [customInstructions, setCustomInstructions] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eligibility = getSummarizeEligibility(chunks, aiSummary)
  const parsed = parseAiSummary(aiSummary)
  const canAttemptGenerate = eligibility.state === 'ready' || eligibility.state === 'has_summary'
  const buttonLabel =
    parsed.ok || (!parsed.ok && parsed.reason === 'invalid')
      ? 'Regenerate Summary'
      : 'Generate Summary'

  async function handleGenerate() {
    if (!canGenerate || !canAttemptGenerate || busy) return

    if (reviewState.status === 'published') {
      const confirmed = window.confirm(PUBLISHED_CONFIRM_MESSAGE)
      if (!confirmed) return
    }

    setBusy(true)
    setError(null)
    try {
      await callSummarizeSession({
        showId,
        sessionId,
        customInstructions: customInstructions.trim() || undefined,
      })
      setCustomInstructions('')
      setShowInstructions(false)
    } catch (err: unknown) {
      if (err instanceof SummarizeSessionError) {
        setError(err.message)
      } else {
        setError(userFacingError(err, 'The summary could not be generated right now.'))
      }
    } finally {
      setBusy(false)
    }
  }

  if (eligibility.state === 'insufficient_content') {
    return (
      <div className="card" style={{ padding: 'var(--space-5)' }}>
        <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>AI summary</h3>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Not enough transcript content to generate a summary yet
          {eligibility.chunkCount === 0
            ? ' — no transcript chunks are stored for this session.'
            : ` (${eligibility.charCount} characters; minimum is 200).`}
        </p>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
          Use the recoverable content check below if you need to diagnose missing transcript data.
        </p>
      </div>
    )
  }

  const emptyMessage =
    !parsed.ok && parsed.reason === 'invalid'
      ? 'Summary data is present but could not be parsed. You can regenerate it from the transcript below.'
      : 'No AI summary has been generated for this session yet.'

  const showEmptyMessage = !parsed.ok

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <div
        className="flex items-center justify-between gap-4"
        style={{ flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}
      >
        <h3 style={{ fontSize: 'var(--text-md)', margin: 0 }}>AI summary</h3>
        {canGenerate ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy || !canAttemptGenerate}
            onClick={() => void handleGenerate()}
          >
            {busy ? 'Generating…' : buttonLabel}
          </button>
        ) : null}
      </div>

      {!parsed.ok && showEmptyMessage ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
          {emptyMessage}
        </p>
      ) : null}

      {canGenerate && canAttemptGenerate ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowInstructions((v) => !v)}
            disabled={busy}
          >
            {showInstructions ? 'Hide instructions' : 'Add instructions (optional)'}
          </button>
          {showInstructions ? (
            <div className="field" style={{ marginTop: 'var(--space-3)' }}>
              <label className="label" htmlFor="summary-custom-instructions">
                One-time instructions for this attempt
              </label>
              <textarea
                id="summary-custom-instructions"
                className="input"
                rows={3}
                maxLength={500}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                disabled={busy}
                placeholder="e.g. Emphasize action items for sponsors."
              />
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                Up to 500 characters. Not saved to the session.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}
