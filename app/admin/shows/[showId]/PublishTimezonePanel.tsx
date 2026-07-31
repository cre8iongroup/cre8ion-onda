'use client'

import { useEffect, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import { DEFAULT_SHOW_TIMEZONE } from '@/lib/branding'

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Toronto',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'UTC',
]

export default function PublishTimezonePanel({
  showId,
  portalPublished,
  showTimezone,
  canEdit,
  onFlash,
}: {
  showId: string
  portalPublished: boolean
  showTimezone: string | undefined
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const [tz, setTz] = useState(showTimezone || DEFAULT_SHOW_TIMEZONE)
  const [published, setPublished] = useState(portalPublished)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTz(showTimezone || DEFAULT_SHOW_TIMEZONE)
    setPublished(portalPublished)
  }, [showTimezone, portalPublished])

  async function save() {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      await updateDoc(doc(getClientFirestore(), 'shows', showId), {
        portalPublished: published,
        showTimezone: tz,
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

      <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
        <label className="label" htmlFor="show-timezone">
          Event timezone
        </label>
        <select
          id="show-timezone"
          className="input"
          value={tz}
          disabled={!canEdit || busy}
          onChange={(e) => setTz(e.target.value)}
        >
          {COMMON_TIMEZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
          {tz && !COMMON_TIMEZONES.includes(tz) ? <option value={tz}>{tz}</option> : null}
        </select>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
          Used for attendee schedule day headers (IANA).
        </p>
      </div>

      {canEdit ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save publish & timezone'}
        </button>
      ) : null}
    </div>
  )
}
