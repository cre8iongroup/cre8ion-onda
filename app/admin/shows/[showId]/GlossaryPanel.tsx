'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
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
      // Collapsed by default when empty; open when variants already exist
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

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  border: '1px solid var(--color-border, #e5e5e5)',
  borderRadius: 999,
  background: 'var(--color-bg-muted, #f5f5f5)',
  lineHeight: 1.3,
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
    const nextHeard = row.alsoHeardAs.filter((v) => v !== variant)
    updateRow(index, {
      alsoHeardAs: nextHeard,
      alsoHeardOpen: nextHeard.length > 0 ? true : row.alsoHeardOpen,
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
    <div className="card" style={{ padding: 'var(--space-4)' }}>
      <p
        className="text-sm"
        style={{ color: 'var(--color-text-secondary)', margin: '0 0 var(--space-3)' }}
      >
        Correct spellings for captions, keyterm boost, and DeepL. Language fields optional
        (blank → Term).
      </p>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
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
              {/* Term row — required */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                  alignItems: 'center',
                }}
              >
                <label className="label" style={{ margin: 0, minWidth: 40 }}>
                  Term
                </label>
                <input
                  className="input"
                  value={row.term}
                  disabled={!canEdit || busy}
                  placeholder="ALPFA"
                  onChange={(e) => updateRow(index, { term: e.target.value })}
                  style={{ flex: '1 1 10rem', minWidth: 0, maxWidth: 280 }}
                  aria-required
                />
                {canEdit ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => setRows(rows.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              {/* Also-heard: collapsed when empty */}
              {!row.alsoHeardOpen && row.alsoHeardAs.length === 0 ? (
                canEdit ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => updateRow(index, { alsoHeardOpen: true })}
                    style={{ justifySelf: 'start', paddingLeft: 0 }}
                  >
                    + Also heard as
                  </button>
                ) : null
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gap: 'var(--space-1)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span
                      className="text-sm"
                      style={{ color: 'var(--color-text-muted)', marginRight: 2 }}
                    >
                      Heard as
                    </span>
                    {row.alsoHeardAs.map((variant) => (
                      <span key={variant} className="text-sm" style={chipStyle}>
                        {variant}
                        {canEdit ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '0 2px', minHeight: 0, lineHeight: 1 }}
                            disabled={busy}
                            aria-label={`Remove ${variant}`}
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
                          style={{ color: 'var(--color-text-muted)', padding: '0 2px' }}
                          aria-hidden
                        >
                          →
                        </span>
                        <span
                          className="text-sm"
                          style={{
                            ...chipStyle,
                            background: 'var(--color-bg, #fff)',
                            fontWeight: 600,
                          }}
                          title="Corrects to Term"
                        >
                          {row.term.trim() || 'Term'}
                        </span>
                      </>
                    ) : null}
                    {canEdit && row.alsoHeardAs.length === 0 ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => updateRow(index, { alsoHeardOpen: false })}
                        style={{ paddingLeft: 4 }}
                      >
                        Collapse
                      </button>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <input
                      className="input"
                      value={row.heardInput}
                      disabled={busy}
                      placeholder="Type a mishearing, Enter to add"
                      onChange={(e) => updateRow(index, { heardInput: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addHeardVariant(index)
                        }
                      }}
                      style={{ maxWidth: 280 }}
                    />
                  ) : null}
                </div>
              )}

              {/* Translations — optional, compact */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(7rem, 1fr))',
                  gap: 'var(--space-2)',
                }}
              >
                {(
                  [
                    ['es', 'ES', row.es],
                    ['pt', 'PT', row.pt],
                    ['fr', 'FR', row.fr],
                  ] as const
                ).map(([field, label, value]) => (
                  <div key={field} className="field" style={{ margin: 0 }}>
                    <label className="label" style={{ marginBottom: 2 }}>
                      {label}{' '}
                      <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>
                        optional
                      </span>
                    </label>
                    <input
                      className="input"
                      value={value}
                      disabled={!canEdit || busy}
                      placeholder={row.term.trim() || '—'}
                      onChange={(e) => updateRow(index, { [field]: e.target.value })}
                    />
                  </div>
                ))}
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
