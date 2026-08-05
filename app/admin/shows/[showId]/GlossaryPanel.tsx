'use client'

import { useEffect, useMemo, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getClientFirestore, getClientFunctions } from '@/lib/firebase/client'
import type { GlossaryEntry } from '@/types'

type DraftRow = {
  key: string
  term: string
  alsoHeardAs: string[]
  heardInput: string
  alsoHeardOpen: boolean
  es: string
  pt: string
  fr: string
}

let rowSeq = 0
function newKey(): string {
  rowSeq += 1
  return `row-${rowSeq}`
}

function normalizeHeardList(raw: string[] | undefined): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const v = item.trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function entriesToDraft(entries: GlossaryEntry[] | undefined): DraftRow[] {
  if (!Array.isArray(entries) || entries.length === 0) return []
  return entries.map((e) => {
    const alsoHeardAs = normalizeHeardList(e.alsoHeardAs)
    return {
      key: newKey(),
      term: e.term ?? '',
      alsoHeardAs,
      heardInput: '',
      alsoHeardOpen: alsoHeardAs.length > 0,
      es: e.translations?.es ?? '',
      pt: e.translations?.pt ?? '',
      fr: e.translations?.fr ?? '',
    }
  })
}

function draftToEntries(rows: DraftRow[]): GlossaryEntry[] {
  return rows
    .map((r) => {
      const alsoHeardAs = normalizeHeardList(r.alsoHeardAs)
      return {
        term: r.term.trim(),
        ...(alsoHeardAs.length > 0 ? { alsoHeardAs } : {}),
        translations: {
          ...(r.es.trim() ? { es: r.es.trim() } : {}),
          ...(r.pt.trim() ? { pt: r.pt.trim() } : {}),
          ...(r.fr.trim() ? { fr: r.fr.trim() } : {}),
        },
      }
    })
    .filter((e) => e.term.length > 0)
}

function serializeEntries(entries: GlossaryEntry[]): string {
  return JSON.stringify(
    entries.map((e) => ({
      term: e.term,
      alsoHeardAs: normalizeHeardList(e.alsoHeardAs),
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

  function addHeardVariant(index: number) {
    const row = rows[index]
    if (!row) return
    const nextHeard = normalizeHeardList([...row.alsoHeardAs, row.heardInput])
    updateRow(index, {
      alsoHeardAs: nextHeard,
      heardInput: '',
      alsoHeardOpen: true,
    })
  }

  function removeHeardVariant(index: number, variant: string) {
    const row = rows[index]
    if (!row) return
    updateRow(index, {
      alsoHeardAs: row.alsoHeardAs.filter((v) => v !== variant),
    })
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
        Show-specific terms for live caption auto-correct, Deepgram keyterm boosting (best-effort
        via Recall), and DeepL translation. Saving updates the Show glossary and registers a new
        DeepL glossary version — translation changes apply to segments translated after sync
        completes. Re-unlock Operator after save if you changed terms used for live recording.
      </p>
      <p
        className="text-sm"
        style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}
      >
        Tip: common English words as “heard as” variants (e.g. Alpha) can false-correct unrelated
        phrases — keep the list specific to stage usage.
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
                  <label className="label">Term</label>
                  <input
                    className="input"
                    value={row.term}
                    disabled={!canEdit || busy}
                    placeholder="e.g. ALPFA"
                    onChange={(e) => updateRow(index, { term: e.target.value })}
                  />
                  <p
                    className="text-sm"
                    style={{ color: 'var(--color-text-muted)', margin: 'var(--space-1) 0 0' }}
                  >
                    Correct spelling. Blank language fields default to this term for DeepL.
                  </p>
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

              <div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() =>
                    updateRow(index, { alsoHeardOpen: !row.alsoHeardOpen })
                  }
                  aria-expanded={row.alsoHeardOpen}
                >
                  {row.alsoHeardOpen ? '▾' : '▸'} Auto-correct captions
                  {row.alsoHeardAs.length > 0 ? ` (${row.alsoHeardAs.length})` : ' (optional)'}
                </button>
                {row.alsoHeardOpen ? (
                  <div
                    style={{
                      marginTop: 'var(--space-2)',
                      padding: 'var(--space-3)',
                      border: '1px solid var(--color-border, #e5e5e5)',
                      borderRadius: 'var(--radius-sm, 6px)',
                      display: 'grid',
                      gap: 'var(--space-2)',
                    }}
                  >
                    <p
                      className="text-sm"
                      style={{ color: 'var(--color-text-muted)', margin: 0 }}
                    >
                      When Deepgram hears… → corrected to Term
                    </p>
                    <div
                      className="flex gap-2"
                      style={{ flexWrap: 'wrap', alignItems: 'center' }}
                    >
                      {row.alsoHeardAs.map((variant) => (
                        <span
                          key={variant}
                          className="text-sm"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--space-1)',
                            padding: '2px 8px',
                            border: '1px solid var(--color-border, #e5e5e5)',
                            borderRadius: '999px',
                          }}
                        >
                          {variant}
                          {canEdit ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '0 4px', minHeight: 0 }}
                              disabled={busy}
                              aria-label={`Remove heard variant ${variant}`}
                              onClick={() => removeHeardVariant(index, variant)}
                            >
                              ×
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {row.alsoHeardAs.length > 0 ? (
                        <>
                          <span
                            className="text-sm"
                            style={{ color: 'var(--color-text-muted)' }}
                            aria-hidden
                          >
                            →
                          </span>
                          <span
                            className="badge badge-muted"
                            title="Corrected spelling (Term)"
                          >
                            {row.term.trim() || 'Term'}
                          </span>
                        </>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                          className="input"
                          value={row.heardInput}
                          disabled={busy}
                          placeholder='e.g. Alpha'
                          onChange={(e) => updateRow(index, { heardInput: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addHeardVariant(index)
                            }
                          }}
                          style={{ flex: '1 1 12rem', minWidth: 0 }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy || !row.heardInput.trim()}
                          onClick={() => addHeardVariant(index)}
                        >
                          Add heard as
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="field-row" style={{ flexWrap: 'wrap' }}>
                <div className="field" style={{ flex: 1, minWidth: 120 }}>
                  <label className="label">Spanish</label>
                  <input
                    className="input"
                    value={row.es}
                    disabled={!canEdit || busy}
                    placeholder={row.term.trim() || undefined}
                    onChange={(e) => updateRow(index, { es: e.target.value })}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 120 }}>
                  <label className="label">Portuguese</label>
                  <input
                    className="input"
                    value={row.pt}
                    disabled={!canEdit || busy}
                    placeholder={row.term.trim() || undefined}
                    onChange={(e) => updateRow(index, { pt: e.target.value })}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 120 }}>
                  <label className="label">French</label>
                  <input
                    className="input"
                    value={row.fr}
                    disabled={!canEdit || busy}
                    placeholder={row.term.trim() || undefined}
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
                {
                  key: newKey(),
                  term: '',
                  alsoHeardAs: [],
                  heardInput: '',
                  alsoHeardOpen: false,
                  es: '',
                  pt: '',
                  fr: '',
                },
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
