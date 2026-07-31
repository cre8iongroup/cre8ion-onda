'use client'

import { useEffect, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'

export default function PublishPanel({
  showId,
  portalPublished,
  canEdit,
  onFlash,
}: {
  showId: string
  portalPublished: boolean
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const [published, setPublished] = useState(portalPublished)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPublished(portalPublished)
  }, [portalPublished])

  async function save() {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      await updateDoc(doc(getClientFirestore(), 'shows', showId), {
        portalPublished: published,
      })
      onFlash(published ? 'Show published to public routes.' : 'Show unpublished from public routes.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}
      <label className="checkbox-row" style={{ marginBottom: 'var(--space-4)' }}>
        <input
          type="checkbox"
          checked={published}
          disabled={!canEdit || busy}
          onChange={(e) => setPublished(e.target.checked)}
        />
        <span>
          Published to public routes (<code>/show/…</code>). Required before attendee pages resolve.
        </span>
      </label>
      {canEdit ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save publish'}
        </button>
      ) : null}
    </div>
  )
}
