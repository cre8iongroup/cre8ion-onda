'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuthContext } from '@/context/AuthContext'
import { normalizeDeepgramKeyterms } from '@/lib/recall/deepgramStreamingPresets'
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

function serializeKeyterms(terms: string[]): string {
  return JSON.stringify(normalizeDeepgramKeyterms(terms))
}

export default function OperatorSettingsPanel({
  showId,
  transcriptionStyle,
  operatorInstructions,
  deepgramKeyterms,
  canEdit,
  onFlash,
}: {
  showId: string
  transcriptionStyle: TranscriptionStyle | undefined
  operatorInstructions: string | undefined
  deepgramKeyterms: string[] | undefined
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const { user } = useAuthContext()
  const serverStyle = normalizeStyle(transcriptionStyle)
  const serverInstructions = operatorInstructions ?? ''
  const serverKeyterms = useMemo(
    () => normalizeDeepgramKeyterms(deepgramKeyterms),
    [deepgramKeyterms],
  )
  const serverKeytermsSerialized = useMemo(
    () => serializeKeyterms(serverKeyterms),
    [serverKeyterms],
  )

  const [draftStyle, setDraftStyle] = useState<TranscriptionStyle | null>(null)
  const [draftInstructions, setDraftInstructions] = useState<string | null>(null)
  const [draftKeyterms, setDraftKeyterms] = useState<string[] | null>(null)
  const [keytermInput, setKeytermInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraftKeyterms(null)
    setKeytermInput('')
  }, [serverKeytermsSerialized])

  const style = draftStyle ?? serverStyle
  const instructions = draftInstructions ?? serverInstructions
  const keyterms = draftKeyterms ?? serverKeyterms

  function addKeyterm() {
    const next = normalizeDeepgramKeyterms([...keyterms, keytermInput])
    if (next.length === keyterms.length) {
      setKeytermInput('')
      return
    }
    setDraftKeyterms(next)
    setKeytermInput('')
  }

  function removeKeyterm(term: string) {
    setDraftKeyterms(keyterms.filter((t) => t !== term))
  }

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
          deepgramKeyterms: normalizeDeepgramKeyterms(keyterms),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`)
      setDraftStyle(null)
      setDraftInstructions(null)
      setDraftKeyterms(null)
      setKeytermInput('')
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

      <div className="field" style={{ marginBottom: 'var(--space-6)' }}>
        <label htmlFor="deepgram-keyterm-input" className="label">
          Deepgram keyterms
        </label>
        <p
          className="text-sm"
          style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}
        >
          Short list of stage-specific terms Deepgram struggles with (e.g. ALPFA). Applied when
          Operator starts recording. Keep this short — boost only terms that need help, not a full
          glossary. Re-unlock Operator after saving mid-show.
        </p>
        {keyterms.length > 0 ? (
          <ul
            style={{
              listStyle: 'none',
              margin: '0 0 var(--space-3)',
              padding: 0,
              display: 'grid',
              gap: 'var(--space-2)',
            }}
          >
            {keyterms.map((term) => (
              <li
                key={term}
                className="flex items-center justify-between gap-3"
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <span className="text-sm" style={{ wordBreak: 'break-word' }}>
                  {term}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => removeKeyterm(term)}
                    disabled={busy}
                    aria-label={`Remove keyterm ${term}`}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p
            className="text-sm"
            style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}
          >
            No keyterms yet.
          </p>
        )}
        {canEdit ? (
          <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              id="deepgram-keyterm-input"
              className="input"
              value={keytermInput}
              onChange={(e) => setKeytermInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addKeyterm()
                }
              }}
              placeholder="e.g. ALPFA"
              disabled={busy}
              style={{ flex: '1 1 12rem', minWidth: 0 }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={addKeyterm}
              disabled={busy || !keytermInput.trim()}
            >
              Add
            </button>
          </div>
        ) : null}
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
