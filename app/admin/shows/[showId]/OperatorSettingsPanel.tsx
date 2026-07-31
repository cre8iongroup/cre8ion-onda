'use client'

import { useState } from 'react'
import { useAuthContext } from '@/context/AuthContext'
import type { TranscriptionStyle } from '@/types'

const STYLE_OPTIONS: Array<{
  value: TranscriptionStyle
  label: string
  recommended?: boolean
  help: string
}> = [
  {
    value: 'standard',
    label: 'Standard',
    recommended: true,
    help: "Numbers, dates, and dollar amounts are converted to written form (e.g. '$150', 'June 5'). Best for most shows.",
  },
  {
    value: 'lightweight',
    label: 'Lightweight',
    help: "Numbers and dates stay as spoken words. A lighter option — worth trying if captions feel like they're lagging on a slow connection.",
  },
]

function normalizeStyle(value: unknown): TranscriptionStyle {
  return value === 'lightweight' ? 'lightweight' : 'standard'
}

export default function OperatorSettingsPanel({
  showId,
  transcriptionStyle,
  operatorInstructions,
  canEdit,
  onFlash,
}: {
  showId: string
  transcriptionStyle: TranscriptionStyle | undefined
  operatorInstructions: string | undefined
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const { user } = useAuthContext()
  const serverStyle = normalizeStyle(transcriptionStyle)
  const serverInstructions = operatorInstructions ?? ''

  const [draftStyle, setDraftStyle] = useState<TranscriptionStyle | null>(null)
  const [draftInstructions, setDraftInstructions] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const style = draftStyle ?? serverStyle
  const instructions = draftInstructions ?? serverInstructions

  async function save() {
    if (!canEdit || !user) return
    setBusy(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/admin/shows/tech-settings', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          showId,
          transcriptionStyle: style,
          operatorInstructions: instructions.trim(),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`)
      setDraftStyle(null)
      setDraftInstructions(null)
      onFlash('Operator settings saved.')
    } catch (err: unknown) {
      console.error('OperatorSettingsPanel:', err)
      const message = err instanceof Error ? err.message : 'Failed to save operator settings.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <div className="field" style={{ marginBottom: 'var(--space-6)' }}>
        <label htmlFor="transcription-style" className="label">
          Transcription style
        </label>
        <select
          id="transcription-style"
          className="input"
          value={style}
          onChange={(e) => setDraftStyle(normalizeStyle(e.target.value))}
          disabled={!canEdit || busy}
        >
          {STYLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
              {opt.recommended ? ' (Recommended)' : ''}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-3)' }}>
          {STYLE_OPTIONS.map((opt) => (
            <div
              key={opt.value}
              className="text-sm"
              style={{
                color:
                  opt.value === style
                    ? 'var(--color-text-secondary)'
                    : 'var(--color-text-muted)',
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {opt.label}
              </span>
              {opt.recommended ? (
                <>
                  {' '}
                  <span className="badge badge-success">Recommended</span>
                </>
              ) : null}
              <p style={{ margin: 'var(--space-1) 0 0' }}>{opt.help}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
        <label htmlFor="operator-instructions" className="label">
          Operator Instructions
        </label>
        <p
          className="text-sm"
          style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}
        >
          Markdown supported (headings, bold, italic, links, lists). Shown read-only in Onda
          Operator under Input / Network. Leave blank to hide.
        </p>
        <textarea
          id="operator-instructions"
          className="input"
          rows={8}
          value={instructions}
          onChange={(e) => setDraftInstructions(e.target.value)}
          placeholder={'## Before go-live\n- Check mic levels\n- Confirm room Wi‑Fi'}
          disabled={!canEdit || busy}
          style={{ resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        />
      </div>

      {canEdit && (
        <button
          type="button"
          id="btn-save-operator-settings"
          className="btn btn-primary"
          onClick={save}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save operator settings'}
        </button>
      )}

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
