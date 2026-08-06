'use client'

import { useEffect, useId, useState } from 'react'

/** Normalize `#RRGGBB` / `RRGGBB` → lowercase `#rrggbb`. Invalid → null. */
export function normalizeHex(raw: string): string | null {
  const v = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase()
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`
  return null
}

export interface ColorFieldProps {
  label: string
  value: string
  disabled?: boolean
  onChange: (hex: string) => void
  /** Optional id prefix; defaults to React useId(). */
  id?: string
}

/**
 * Swatch + hex text color control.
 * Native `<input type="color">` is opacity-0 over a real background swatch so
 * global `.input` styles cannot fight the native control (see branding fix
 * in BrandingPanel / PR #47).
 */
export default function ColorField({
  label,
  value,
  disabled,
  onChange,
  id: idProp,
}: ColorFieldProps) {
  const reactId = useId()
  const id = idProp || reactId
  const [text, setText] = useState(value)

  useEffect(() => {
    setText(value)
  }, [value])

  const swatchValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'

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
            background: /^#[0-9a-fA-F]{6}$/.test(value) ? value : swatchValue,
          }}
          title={label}
        >
          <input
            id={`${id}-swatch`}
            type="color"
            value={swatchValue}
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
