'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getClientFirestore, getClientFunctions } from '@/lib/firebase/client'
import type { GlossaryEntry } from '@/types'

type DraftRow = {
  key: string
  term: string
  alsoHeardAs: string[]
  heardInput: string
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
  return entries.map((e) => ({
    key: newKey(),
    term: e.term ?? '',
    alsoHeardAs: normalizeHeardList(e.alsoHeardAs),
    heardInput: '',
    es: e.translations?.es ?? '',
    pt: e.translations?.pt ?? '',
    fr: e.translations?.fr ?? '',
  }))
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

function parseBulkTerms(raw: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[\n,]+/)) {
    const term = part.trim()
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}

function emptyRow(term = ''): DraftRow {
  return {
    key: newKey(),
    term,
    alsoHeardAs: [],
    heardInput: '',
    es: '',
    pt: '',
    fr: '',
  }
}

/** Term pills in the cloud — uniform; no configured-vs-bare hierarchy. */
const termPillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  lineHeight: 1.3,
  cursor: 'pointer',
}

const termPillExpandedStyle: CSSProperties = {
  ...termPillStyle,
  borderColor: 'var(--color-primary)',
  boxShadow: '0 0 0 1px var(--color-primary)',
}

/**
 * Mishearing chips — muted / low-emphasis ("input" / variant).
 * Intentionally NOT the same surface as the target chip.
 */
const mishearingChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-elevated)',
  color: 'var(--color-text-muted)',
  fontWeight: 400,
  fontSize: 'var(--text-sm)',
  lineHeight: 1.3,
}

/**
 * Target term chip — high-emphasis ("the answer" / correction).
 * Solid primary fill + bold light text; must read as distinct from mishearing chips at a glance.
 */
const targetChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid var(--color-primary)',
  background: 'var(--color-primary)',
  color: '#ffffff',
  fontWeight: 700,
  fontSize: 'var(--text-sm)',
  lineHeight: 1.3,
}

/** Visible arrow between mishearing → target (not implied by spacing alone). */
const heardArrowStyle: CSSProperties = {
  color: 'var(--color-text-secondary)',
  fontWeight: 700,
  fontSize: 'var(--text-md)',
  padding: '0 6px',
  lineHeight: 1,
  userSelect: 'none',
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
  const [search, setSearch] = useState('')
  const [addInput, setAddInput] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setBaseline(entriesToDraft(glossary))
    setDraft(null)
    setExpandedKey(null)
  }, [serverSerialized, glossary])

  const rows = draft ?? baseline

  function setRows(next: DraftRow[]) {
    setDraft(next)
  }

  function updateRow(index: number, patch: Partial<DraftRow>) {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function termExists(term: string, exceptKey?: string): boolean {
    const key = term.trim().toLowerCase()
    if (!key) return false
    return rows.some(
      (r) => r.key !== exceptKey && r.term.trim().toLowerCase() === key,
    )
  }

  function addTerms(terms: string[]) {
    if (!canEdit || terms.length === 0) return
    const next = [...rows]
    let added = 0
    for (const term of terms) {
      const trimmed = term.trim()
      if (!trimmed) continue
      if (termExists(trimmed) || next.some((r) => r.term.trim().toLowerCase() === trimmed.toLowerCase())) {
        continue
      }
      next.push(emptyRow(trimmed))
      added += 1
    }
    if (added > 0) setRows(next)
  }

  function fastAdd() {
    const term = addInput.trim()
    if (!term) return
    addTerms([term])
    setAddInput('')
    // Keep focus for rapid successive adds
    requestAnimationFrame(() => addInputRef.current?.focus())
  }

  function addBulk() {
    const terms = parseBulkTerms(bulkText)
    addTerms(terms)
    setBulkText('')
    setBulkOpen(false)
  }

  function addHeardVariant(index: number) {
    const row = rows[index]
    if (!row) return
    const nextHeard = normalizeHeardList([...row.alsoHeardAs, row.heardInput])
    updateRow(index, {
      alsoHeardAs: nextHeard,
      heardInput: '',
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
      setExpandedKey(null)
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

  const searchNorm = search.trim().toLowerCase()
  const visibleRows = searchNorm
    ? rows.filter((r) => r.term.toLowerCase().includes(searchNorm))
    : rows

  function onAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      fastAdd()
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-4)' }}>
      <p
        className="text-sm"
        style={{ color: 'var(--color-text-secondary)', margin: '0 0 var(--space-3)' }}
      >
        Correct spellings for captions, keyterm boost, and DeepL. Click a term to edit heard-as
        variants and optional translations (blank → Term).
      </p>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
          alignItems: 'center',
        }}
      >
        <input
          className="input"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search terms…"
          aria-label="Search glossary terms"
          style={{ flex: '1 1 12rem', minWidth: 0, maxWidth: 320 }}
        />
        {canEdit ? (
          <>
            <input
              ref={addInputRef}
              className="input"
              value={addInput}
              disabled={busy}
              placeholder="Add term, Enter for next"
              aria-label="Add glossary term"
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={onAddKeyDown}
              style={{ flex: '1 1 14rem', minWidth: 0, maxWidth: 360 }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setBulkOpen((o) => !o)}
              aria-expanded={bulkOpen}
            >
              {bulkOpen ? 'Hide paste list' : 'Paste list'}
            </button>
          </>
        ) : null}
      </div>

      {canEdit && bulkOpen ? (
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-3)',
            padding: 'var(--space-3)',
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
          }}
        >
          <label className="label" htmlFor="glossary-bulk-paste" style={{ margin: 0 }}>
            Paste terms (comma- or newline-separated)
          </label>
          <textarea
            id="glossary-bulk-paste"
            className="input"
            rows={4}
            value={bulkText}
            disabled={busy}
            placeholder={'ALPFA\nalfa, alpha\nCre8ion'}
            onChange={(e) => setBulkText(e.target.value)}
            style={{ resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy || !bulkText.trim()}
              onClick={addBulk}
            >
              Add terms
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                setBulkText('')
                setBulkOpen(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: '0 0 var(--space-3)' }}>
          No glossary terms yet.
        </p>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: '0 0 var(--space-3)' }}>
          No terms match “{search.trim()}”.
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 'var(--space-3)',
            alignItems: 'flex-start',
          }}
          role="list"
          aria-label="Glossary terms"
        >
          {visibleRows.map((row) => {
            const index = rows.findIndex((r) => r.key === row.key)
            const expanded = expandedKey === row.key
            const label = row.term.trim() || '(untitled)'
            return (
              <div key={row.key} role="listitem" style={{ display: 'contents' }}>
                <button
                  type="button"
                  style={expanded ? termPillExpandedStyle : termPillStyle}
                  aria-expanded={expanded}
                  onClick={() => setExpandedKey(expanded ? null : row.key)}
                >
                  {label}
                </button>
                {expanded ? (
                  <div
                    style={{
                      flexBasis: '100%',
                      width: '100%',
                      marginTop: 4,
                      marginBottom: 8,
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg-elevated)',
                      display: 'grid',
                      gap: 'var(--space-3)',
                    }}
                  >
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
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setExpandedKey(null)}
                      >
                        Collapse
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => {
                            setRows(rows.filter((r) => r.key !== row.key))
                            setExpandedKey(null)
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                      <span
                        className="text-sm"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        Heard as
                      </span>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        {row.alsoHeardAs.length === 0 ? (
                          <span
                            className="text-sm"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            No mishearings yet
                          </span>
                        ) : (
                          <>
                            {row.alsoHeardAs.map((variant) => (
                              <span key={variant} className="text-sm" style={mishearingChipStyle}>
                                {variant}
                                {canEdit ? (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{
                                      padding: '0 2px',
                                      minHeight: 0,
                                      lineHeight: 1,
                                      color: 'var(--color-text-muted)',
                                    }}
                                    disabled={busy}
                                    aria-label={`Remove ${variant}`}
                                    onClick={() => removeHeardVariant(index, variant)}
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </span>
                            ))}
                            <span style={heardArrowStyle} aria-hidden>
                              →
                            </span>
                            <span
                              className="text-sm"
                              style={targetChipStyle}
                              title="Corrects to Term"
                            >
                              {row.term.trim() || 'Term'}
                            </span>
                          </>
                        )}
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
                      ).map(([field, langLabel, value]) => (
                        <div key={field} className="field" style={{ margin: 0 }}>
                          <label className="label" style={{ marginBottom: 2 }}>
                            {langLabel}{' '}
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
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {canEdit ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save glossary'}
          </button>
          {dirty ? (
            <span className="text-sm" style={{ color: 'var(--color-text-muted)', alignSelf: 'center' }}>
              Unsaved changes
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
