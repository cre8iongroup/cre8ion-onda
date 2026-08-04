'use client'

import { useEffect, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'

const LANGUAGE_OPTIONS: Array<{ code: string; label: string; locked?: boolean }> = [
  { code: 'en', label: 'English (source)', locked: true },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'fr', label: 'French' },
]

function normalizeLanguages(raw: string[] | undefined): string[] {
  const allowed = new Set(LANGUAGE_OPTIONS.map((o) => o.code))
  const selected = (raw ?? []).filter((c) => allowed.has(c))
  if (!selected.includes('en')) selected.unshift('en')
  return [...new Set(selected)]
}

export default function LanguagesPanel({
  showId,
  defaultLanguages,
  canEdit,
  onFlash,
}: {
  showId: string
  defaultLanguages: string[] | undefined
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const [draft, setDraft] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const server = normalizeLanguages(defaultLanguages)
  const selected = draft ?? server

  useEffect(() => {
    setDraft(null)
  }, [defaultLanguages])

  function toggle(code: string, locked?: boolean) {
    if (!canEdit || locked || busy) return
    const next = selected.includes(code)
      ? selected.filter((c) => c !== code)
      : [...selected, code]
    setDraft(normalizeLanguages(next))
  }

  async function save() {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      const languages = normalizeLanguages(selected)
      await updateDoc(doc(getClientFirestore(), 'shows', showId), {
        defaultLanguages: languages,
      })
      setDraft(null)
      onFlash('Caption languages saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save languages.')
    } finally {
      setBusy(false)
    }
  }

  const dirty = draft !== null && draft.join(',') !== server.join(',')

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <p
        className="text-sm"
        style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}
      >
        Languages offered on attendee caption pages for every session in this show. English is
        always included (live transcription source). Translations run for every selected language
        other than English.
      </p>
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}

      <fieldset
        disabled={!canEdit || busy}
        style={{ border: 0, margin: 0, padding: 0, marginBottom: 'var(--space-4)' }}
      >
        <legend className="label" style={{ marginBottom: 'var(--space-3)' }}>
          Supported languages
        </legend>
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {LANGUAGE_OPTIONS.map((opt) => {
            const checked = selected.includes(opt.code)
            return (
              <label
                key={opt.code}
                className="text-sm"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  color: 'var(--color-text-primary)',
                  cursor: !canEdit || opt.locked ? 'default' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!canEdit || busy || Boolean(opt.locked)}
                  onChange={() => toggle(opt.code, opt.locked)}
                />
                <span>{opt.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {canEdit ? (
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save languages'}
        </button>
      ) : null}
    </div>
  )
}
