'use client'

import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import type { ShowLink } from '@/types'

export default function ShowLinksPanel({
  showId,
  links,
  canEdit,
  onFlash,
}: {
  showId: string
  links: ShowLink[] | undefined
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const sorted = [...(links ?? [])].sort((a, b) => a.order - b.order)
  const [draft, setDraft] = useState<ShowLink[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = draft ?? sorted

  function setRows(next: ShowLink[]) {
    setDraft(next.map((l, i) => ({ ...l, order: i })))
  }

  async function save(next: ShowLink[]) {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      const normalized = next.map((l, i) => ({
        title: l.title.trim(),
        url: l.url.trim(),
        order: i,
      }))
      await updateDoc(doc(getClientFirestore(), 'shows', showId), { links: normalized })
      setDraft(null)
      onFlash('Show links saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save links.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
        Ordered links on the public show home. No visibility rules in v1.
      </p>
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        {rows.map((link, index) => (
          <div key={index} className="field-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label className="label">Title</label>
              <input
                className="input"
                value={link.title}
                disabled={!canEdit || busy}
                onChange={(e) => {
                  const next = [...rows]
                  next[index] = { ...link, title: e.target.value }
                  setRows(next)
                }}
              />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 180 }}>
              <label className="label">URL</label>
              <input
                className="input"
                value={link.url}
                disabled={!canEdit || busy}
                onChange={(e) => {
                  const next = [...rows]
                  next[index] = { ...link, url: e.target.value }
                  setRows(next)
                }}
              />
            </div>
            {canEdit ? (
              <div className="flex gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy || index === 0}
                  onClick={() => {
                    const next = [...rows]
                    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                    setRows(next)
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy || index === rows.length - 1}
                  onClick={() => {
                    const next = [...rows]
                    ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                    setRows(next)
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {canEdit ? (
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => setRows([...rows, { title: '', url: 'https://', order: rows.length }])}
          >
            + Add link
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || draft === null}
            onClick={() => void save(rows)}
          >
            {busy ? 'Saving…' : 'Save links'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
