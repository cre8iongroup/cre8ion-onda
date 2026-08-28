'use client'

import { useState, type ReactNode } from 'react'
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
  variant?: 'default' | 'hero'
  heroActions?: ReactNode
  summaryDisplay?: ReactNode
}

export default function AiSummaryGenerateControls({
  showId,
  sessionId,
  reviewState,
  aiSummary,
  chunks,
  canGenerate,
  variant = 'default',
  heroActions,
  summaryDisplay,
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

  const generateButton =
    canGenerate && canAttemptGenerate ? (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy || !canAttemptGenerate}
        onClick={() => void handleGenerate()}
      >
        {busy ? 'Generating…' : buttonLabel}
      </button>
    ) : null

  if (eligibility.state === 'insufficient_content') {
    const body = (
      <>
        {variant === 'default' ? (
          <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>AI summary</h3>
        ) : null}
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', lineHeight: 1.65 }}>
          This session couldn&apos;t be summarized — there isn&apos;t enough transcript content to
          work with, which usually means something went wrong during recording or transcription.{' '}
          <a
            href="#review-session-diagnostics"
            className="text-sm"
            style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
            onClick={(e) => {
              e.preventDefault()
              const el = document.getElementById('review-session-diagnostics')
              if (el instanceof HTMLDetailsElement) {
                el.open = true
                el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            }}
          >
            Check the diagnostics below
          </a>{' '}
          to see what&apos;s missing, or reach out to the Tech team if you&apos;re not sure how to
          proceed.
        </p>
      </>
    )

    if (variant === 'hero') {
      return (
        <div
          className="card"
          style={{
            padding: 'var(--space-5)',
            borderColor: 'var(--color-accent)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>AI summary</h2>
          {body}
        </div>
      )
    }

    return (
      <div className="card" style={{ padding: 'var(--space-5)' }}>
        {body}
      </div>
    )
  }

  const emptyMessage =
    !parsed.ok && parsed.reason === 'invalid'
      ? 'Summary data is present but could not be parsed. You can regenerate it from the transcript below.'
      : 'No AI summary has been generated for this session yet.'

  const showEmptyMessage = !parsed.ok

  const body = (
    <>
      {variant === 'default' ? (
        <div
          className="flex items-center justify-between gap-4"
          style={{ flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}
        >
          <h3 style={{ fontSize: 'var(--text-md)', margin: 0 }}>AI summary</h3>
          {generateButton}
        </div>
      ) : null}

      {!parsed.ok && showEmptyMessage ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
          {emptyMessage}
        </p>
      ) : null}

      {canGenerate && canAttemptGenerate ? (
        <div style={{ marginBottom: variant === 'default' ? 'var(--space-4)' : 0 }}>
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
        <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
          {error}
        </div>
      ) : null}
    </>
  )

  if (variant === 'hero') {
    return (
      <div
        className="card"
        style={{
          padding: 'var(--space-5)',
          borderColor: 'var(--color-accent)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div
          className="flex items-center justify-between gap-4"
          style={{ flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}
        >
          <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>AI summary</h2>
          <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            {generateButton}
            {heroActions}
          </div>
        </div>
        {body}
        {summaryDisplay ? (
          <div
            style={{
              marginTop: 'var(--space-5)',
              paddingTop: 'var(--space-5)',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            {summaryDisplay}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      {body}
    </div>
  )
}
