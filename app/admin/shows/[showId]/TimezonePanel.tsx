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

export default function TimezonePanel({
  showId,
  showTimezone,
  canEdit,
  onFlash,
}: {
  showId: string
  showTimezone: string | undefined
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const [tz, setTz] = useState(showTimezone || DEFAULT_SHOW_TIMEZONE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTz(showTimezone || DEFAULT_SHOW_TIMEZONE)
  }, [showTimezone])

  async function save() {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      await updateDoc(doc(getClientFirestore(), 'shows', showId), { showTimezone: tz })
      onFlash('Timezone saved.')
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
          Used for attendee schedule day headers (IANA). Independent of publish state.
        </p>
      </div>
      {canEdit ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save timezone'}
        </button>
      ) : null}
    </div>
  )
}
