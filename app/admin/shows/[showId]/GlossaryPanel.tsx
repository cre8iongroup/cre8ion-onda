'use client'

import { useEffect, useMemo, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getClientFirestore, getClientFunctions } from '@/lib/firebase/client'
import type { GlossaryEntry } from '@/types'

type DraftRow = {
  key: string
  term: string
  es: string
  pt: string
  fr: string
}

let rowSeq = 0
function newKey(): string {
  rowSeq += 1
  return `row-${rowSeq}`
}

function entriesToDraft(entries: GlossaryEntry[] | undefined): DraftRow[] {
  if (!Array.isArray(entries) || entries.length === 0) return []
  return entries.map((e) => ({
    key: newKey(),
    term: e.term ?? '',
    es: e.translations?.es ?? '',
    pt: e.translations?.pt ?? '',
    fr: e.translations?.fr ?? '',
  }))
}

function draftToEntries(rows: DraftRow[]): GlossaryEntry[] {
  return rows
    .map((r) => ({
      term: r.term.trim(),
      translations: {
        ...(r.es.trim() ? { es: r.es.trim() } : {}),
        ...(r.pt.trim() ? { pt: r.pt.trim() } : {}),
        ...(r.fr.trim() ? { fr: r.fr.trim() } : {}),
      },
    }))
    .filter((e) => e.term.length > 0)
}

function serializeEntries(entries: GlossaryEntry[]): string {
  return JSON.stringify(
    entries.map((e) => ({
      term: e.term,
      es: e.translations?.es ?? '',
      pt: e.translations?.pt ?? '',
      fr: e.translations?.fr ?? '',
    })),
  )
}

export default function GlossaryPanel({
  showId,
  glossary,
  canEdit,
  onFlash,
}: {
  showId: string
  glossary: GlossaryEntry[] | undefined
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const serverSerialized = useMemo(
    () => serializeEntries(Array.isArray(glossary) ? glossary : []),
    [glossary],
  )
  const [baseline, setBaseline] = useState<DraftRow[]>(() => entriesToDraft(glossary))
  const [draft, setDraft] = useState<DraftRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBaseline(entriesToDraft(glossary))
    setDraft(null)
  }, [serverSerialized, glossary])

  const rows = draft ?? baseline

  function setRows(next: DraftRow[]) {
    setDraft(next)
  }

  function updateRow(index: number, patch: Partial<DraftRow>) {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    setRows(next)
  }

  async function save() {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      const entries = draftToEntries(rows)
      await updateDoc(doc(getClientFirestore(), 'shows', showId), { glossary: entries })

      const sync = httpsCallable(getClientFunctions(), 'syncDeepLGlossary')
      const result = await sync({ showId })
      const data = (result.data ?? {}) as { ok?: boolean; partialError?: string | null }

      setDraft(null)
      if (data.partialError) {
        onFlash('Glossary saved; DeepL sync partially failed — check Cloud Function logs.')
      } else {
        onFlash('Glossary saved and synced to DeepL.')
      }
    } catch (err: unknown) {
      console.error('GlossaryPanel:', err)
      const message =
        err instanceof Error ? err.message : 'Failed to save or sync glossary.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const dirty =
    draft !== null && serializeEntries(draftToEntries(draft)) !== serverSerialized

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <p
        className="text-sm"
        style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}
      >
        Preferred translations for show-specific terms. Saving updates the Show glossary and
        registers a new DeepL glossary version — changes apply to segments translated after sync
        completes.
      </p>
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: 0 }}>
            No glossary terms yet.
          </p>
        ) : (
          rows.map((row, index) => (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gap: 'var(--space-2)',
                paddingBottom: 'var(--space-3)',
                borderBottom: '1px solid var(--color-border, #e5e5e5)',
              }}
            >
              <div className="field-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="field" style={{ flex: 2, minWidth: 160 }}>
                  <label className="label">English term</label>
                  <input
                    className="input"
                    value={row.term}
                    disabled={!canEdit || busy}
                    onChange={(e) => updateRow(index, { term: e.target.value })}
                  />
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => setRows(rows.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="field-row" style={{ flexWrap: 'wrap' }}>
                <div className="field" style={{ flex: 1, minWidth: 120 }}>
                  <label className="label">Spanish</label>
                  <input
                    className="input"
                    value={row.es}
                    disabled={!canEdit || busy}
                    onChange={(e) => updateRow(index, { es: e.target.value })}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 120 }}>
                  <label className="label">Portuguese</label>
                  <input
                    className="input"
                    value={row.pt}
                    disabled={!canEdit || busy}
                    onChange={(e) => updateRow(index, { pt: e.target.value })}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 120 }}>
                  <label className="label">French</label>
                  <input
                    className="input"
                    value={row.fr}
                    disabled={!canEdit || busy}
                    onChange={(e) => updateRow(index, { fr: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {canEdit ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() =>
              setRows([
                ...rows,
                { key: newKey(), term: '', es: '', pt: '', fr: '' },
              ])
            }
          >
            Add term
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save glossary'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
