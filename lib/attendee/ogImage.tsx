/**
 * Shared Open Graph card renderer for attendee routes (ImageResponse / Satori).
 *
 * Uses SHOW branding (logo + background + accent). Page-specific title is
 * passed by each opengraph-image route. Falls back to an Onda default card
 * when branding/logo is missing.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_TEXT_COLOR,
} from '@/lib/branding'
import type { EffectiveBranding } from '@/types'

export const OG_SIZE = { width: 1200, height: 630 } as const
export const OG_CONTENT_TYPE = 'image/png'

type ShareBranding = Pick<EffectiveBranding, 'logoUrl' | 'backgroundColor' | 'textColor' | 'accentColors'>

let cachedDefaultLogoDataUrl: string | null | undefined

async function loadDefaultOndaLogoDataUrl(): Promise<string | null> {
  if (cachedDefaultLogoDataUrl !== undefined) return cachedDefaultLogoDataUrl
  try {
    const buf = await readFile(join(process.cwd(), 'public/onda-operator-icon.png'))
    cachedDefaultLogoDataUrl = `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    cachedDefaultLogoDataUrl = null
  }
  return cachedDefaultLogoDataUrl
}

export async function renderAttendeeOgImage(opts: {
  title: string
  /** SHOW branding only (not room-effective override). Null → Onda defaults. */
  branding?: ShareBranding | null
  /** Optional secondary line (e.g. show name under a room/session title). */
  eyebrow?: string
}): Promise<ImageResponse> {
  const title = opts.title?.trim() || 'cre8ion Onda'
  const branding = opts.branding

  const backgroundColor = branding?.backgroundColor || DEFAULT_BACKGROUND_COLOR
  const textColor = branding?.textColor || DEFAULT_TEXT_COLOR
  const accent = branding?.accentColors?.[0] || DEFAULT_PRIMARY_COLOR

  const showLogo = branding?.logoUrl?.trim() || ''
  const defaultLogo = showLogo ? null : await loadDefaultOndaLogoDataUrl()
  const logoSrc = showLogo || defaultLogo
  // Wordmark only when neither show logo nor bundled Onda icon is available.
  const wordmark = logoSrc ? null : 'cre8ion Onda'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          backgroundColor,
          color: textColor,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc}
              alt=""
              width={200}
              height={96}
              style={{
                objectFit: 'contain',
                objectPosition: 'left center',
              }}
            />
          ) : (
            <div
              style={{
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: -0.5,
                color: accent,
              }}
            >
              {wordmark}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {opts.eyebrow?.trim() ? (
            <div
              style={{
                fontSize: 28,
                marginBottom: 16,
                opacity: 0.7,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              {opts.eyebrow.trim()}
            </div>
          ) : null}
          <div
            style={{
              fontSize: title.length > 48 ? 52 : 64,
              fontWeight: 700,
              letterSpacing: -1.5,
              lineHeight: 1.15,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
          <div
            style={{
              marginTop: 28,
              width: 96,
              height: 8,
              backgroundColor: accent,
              borderRadius: 4,
            }}
          />
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
    },
  )
}

/** Default Onda card when a show cannot be resolved. */
export async function renderDefaultOndaOgImage(): Promise<ImageResponse> {
  return renderAttendeeOgImage({ title: 'cre8ion Onda', branding: null })
}
