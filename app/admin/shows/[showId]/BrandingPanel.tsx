'use client'

import { useRef, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { getClientFirestore, getClientStorage } from '@/lib/firebase/client'
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  DEFAULT_TEXT_COLOR,
  syncAccentFields,
} from '@/lib/branding'
import type { ShowBranding } from '@/types'

export default function BrandingPanel({
  showId,
  branding,
  canEdit,
  onFlash,
}: {
  showId: string
  branding: ShowBranding
  canEdit: boolean
  onFlash: (message: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor || DEFAULT_PRIMARY_COLOR)
  const [secondaryColor, setSecondaryColor] = useState(
    branding.secondaryColor || DEFAULT_SECONDARY_COLOR,
  )
  const [backgroundColor, setBackgroundColor] = useState(
    branding.backgroundColor || DEFAULT_BACKGROUND_COLOR,
  )
  const [textColor, setTextColor] = useState(branding.textColor || DEFAULT_TEXT_COLOR)
  const [logoURL, setLogoURL] = useState(branding.logoURL || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function uploadLogo(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `shows/${showId}/logo.${ext}`
    const storageRef = ref(getClientStorage(), path)
    await uploadBytes(storageRef, file, { contentType: file.type || 'image/png' })
    return getDownloadURL(storageRef)
  }

  async function save() {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      const accents = syncAccentFields({ primaryColor, secondaryColor })
      await updateDoc(doc(getClientFirestore(), 'shows', showId), {
        'branding.primaryColor': accents.primaryColor,
        'branding.secondaryColor': accents.secondaryColor,
        'branding.accentColors': accents.accentColors,
        'branding.backgroundColor': backgroundColor,
        'branding.textColor': textColor,
        'branding.logoURL': logoURL,
      })
      onFlash('Branding saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save branding.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
        Palette only for v1 (logo + background, text, two accents). Accents stay synced with
        primary/secondary for Operator compatibility.
      </p>
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}

      <div className="field-row" style={{ flexWrap: 'wrap' }}>
        <div className="field">
          <label className="label" htmlFor="brand-bg">Background</label>
          <input
            id="brand-bg"
            type="color"
            className="input"
            value={backgroundColor}
            disabled={!canEdit || busy}
            onChange={(e) => setBackgroundColor(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="brand-text">Text</label>
          <input
            id="brand-text"
            type="color"
            className="input"
            value={textColor}
            disabled={!canEdit || busy}
            onChange={(e) => setTextColor(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="brand-primary">Accent 1</label>
          <input
            id="brand-primary"
            type="color"
            className="input"
            value={primaryColor}
            disabled={!canEdit || busy}
            onChange={(e) => setPrimaryColor(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="brand-secondary">Accent 2</label>
          <input
            id="brand-secondary"
            type="color"
            className="input"
            value={secondaryColor}
            disabled={!canEdit || busy}
            onChange={(e) => setSecondaryColor(e.target.value)}
          />
        </div>
      </div>

      <div className="field" style={{ marginTop: 'var(--space-4)' }}>
        <label className="label">Logo</label>
        {logoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoURL} alt="" style={{ maxHeight: 48, marginBottom: 8, display: 'block' }} />
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          disabled={!canEdit || busy}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setBusy(true)
            setError(null)
            try {
              const url = await uploadLogo(file)
              setLogoURL(url)
              onFlash('Logo uploaded — click Save branding to persist.')
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : 'Logo upload failed.')
            } finally {
              setBusy(false)
              e.target.value = ''
            }
          }}
        />
      </div>

      {canEdit ? (
        <button
          type="button"
          id="btn-save-branding"
          className="btn btn-primary"
          style={{ marginTop: 'var(--space-4)' }}
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save branding'}
        </button>
      ) : null}
    </div>
  )
}
