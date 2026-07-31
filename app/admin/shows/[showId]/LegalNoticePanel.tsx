'use client'

import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'

/**
 * Admin editor for ShowBranding.legalNotice.
 *
 * Phase 5 (when this is rendered for attendees/output): restrict markdown to
 * paragraphs, bold, italic, links, and line breaks only — no headings, no lists,
 * no underline. Narrower than Operator Instructions.
 */
export default function LegalNoticePanel({
  showId,
  legalNotice,
  canEdit,
  onFlash,
}: {
  showId: string
  legalNotice: string | undefined
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const serverNotice = legalNotice ?? ''
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = draft ?? serverNotice

  async function save() {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      const trimmed = value.trim()
      await updateDoc(doc(getClientFirestore(), 'shows', showId), {
        'branding.legalNotice': trimmed,
      })
      setDraft(null)
      onFlash('Legal notice saved.')
    } catch (err: unknown) {
      console.error('LegalNoticePanel:', err)
      const message = err instanceof Error ? err.message : 'Failed to save legal notice.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
        <label htmlFor="legal-notice" className="label">
          Legal notice
        </label>
        <p
          className="text-sm"
          style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}
        >
          Optional markdown for a short per-show attribution or terms message (e.g. powered-by
          line + client terms link). Shown on attendee footers — use paragraphs, bold, italic,
          and links only.
        </p>
        <textarea
          id="legal-notice"
          className="input"
          rows={5}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'Powered by Onda. [Client terms](https://example.com/terms).'}
          disabled={!canEdit || busy}
          style={{ resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        />
      </div>

      {canEdit && (
        <button
          type="button"
          id="btn-save-legal-notice"
          className="btn btn-primary"
          onClick={save}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save legal notice'}
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
