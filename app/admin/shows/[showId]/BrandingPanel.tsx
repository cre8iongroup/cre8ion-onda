'use client'

import { useEffect, useId, useRef, useState } from 'react'
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

function normalizeHex(raw: string): string | null {
  const v = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase()
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`
  return null
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (hex: string) => void
}) {
  const id = useId()
  const [text, setText] = useState(value)

  useEffect(() => {
    setText(value)
  }, [value])

  return (
    <div className="field">
      <label className="label" htmlFor={`${id}-hex`}>
        {label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label
          htmlFor={`${id}-swatch`}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            overflow: 'hidden',
            border: '1px solid var(--color-border)',
            flexShrink: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'block',
            background: value,
          }}
          title={label}
        >
          <input
            id={`${id}-swatch`}
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            style={{
              opacity: 0,
              width: '100%',
              height: '100%',
              border: 'none',
              padding: 0,
              cursor: 'inherit',
            }}
          />
        </label>
        <input
          id={`${id}-hex`}
          className="input"
          value={text}
          disabled={disabled}
          spellCheck={false}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', maxWidth: 120 }}
          onChange={(e) => {
            const next = e.target.value
            setText(next)
            const hex = normalizeHex(next)
            if (hex) onChange(hex)
          }}
          onBlur={() => {
            const hex = normalizeHex(text)
            if (hex) {
              setText(hex)
              onChange(hex)
            } else {
              setText(value)
            }
          }}
        />
      </div>
    </div>
  )
}

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
  const [logoFileName, setLogoFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPrimaryColor(branding.primaryColor || DEFAULT_PRIMARY_COLOR)
    setSecondaryColor(branding.secondaryColor || DEFAULT_SECONDARY_COLOR)
    setBackgroundColor(branding.backgroundColor || DEFAULT_BACKGROUND_COLOR)
    setTextColor(branding.textColor || DEFAULT_TEXT_COLOR)
    setLogoURL(branding.logoURL || '')
  }, [branding])

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

      <div className="field" style={{ marginBottom: 'var(--space-5)' }}>
        <label className="label">Logo</label>
        {logoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoURL}
            alt="Show logo preview"
            style={{
              display: 'block',
              maxHeight: 64,
              maxWidth: 'min(280px, 100%)',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              objectPosition: 'left center',
              marginBottom: 8,
              background: 'transparent',
            }}
          />
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          disabled={!canEdit || busy}
          tabIndex={-1}
          aria-hidden
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setLogoFileName(file.name)
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
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!canEdit || busy}
            onClick={() => fileRef.current?.click()}
          >
            Choose file
          </button>
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {logoFileName || 'No file chosen'}
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-5)',
        }}
      >
        <ColorField
          label="Background"
          value={backgroundColor}
          disabled={!canEdit || busy}
          onChange={setBackgroundColor}
        />
        <ColorField
          label="Text"
          value={textColor}
          disabled={!canEdit || busy}
          onChange={setTextColor}
        />
        <ColorField
          label="Accent 1"
          value={primaryColor}
          disabled={!canEdit || busy}
          onChange={setPrimaryColor}
        />
        <ColorField
          label="Accent 2"
          value={secondaryColor}
          disabled={!canEdit || busy}
          onChange={setSecondaryColor}
        />
      </div>

      <div
        aria-label="Branding preview"
        style={{
          marginBottom: 'var(--space-5)',
          padding: 'var(--space-5)',
          borderRadius: 12,
          background: backgroundColor,
          color: textColor,
          border: '1px solid var(--color-border)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '1.125rem', marginBottom: 8 }}>Preview</div>
        <p style={{ margin: '0 0 12px', opacity: 0.9 }}>
          Sample body text on your background with the chosen text color.
        </p>
        <span
          style={{
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: 999,
            background: primaryColor,
            color: backgroundColor,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Accent badge
        </span>
      </div>

      {canEdit ? (
        <button
          type="button"
          id="btn-save-branding"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save branding'}
        </button>
      ) : null}
    </div>
  )
}
