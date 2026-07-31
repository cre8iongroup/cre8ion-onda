'use client'

import { useEffect } from 'react'

/** Matches root layout / manifest default (Onda purple). */
export const ONDA_DEFAULT_THEME_COLOR = '#5b3aee'

/**
 * Sets <meta name="theme-color"> to the page's effective branding background.
 * Runs client-side so it updates when branding arrives after first paint.
 * Restores the Onda default on unmount (non-attendee / no-show context).
 * Does not touch viewport-fit / safe-area — those stay on the root viewport.
 */
export function AttendeeThemeColor({ backgroundColor }: { backgroundColor: string }) {
  useEffect(() => {
    const color = backgroundColor?.trim() || ONDA_DEFAULT_THEME_COLOR
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
    let created = false

    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
      created = true
    }

    meta.setAttribute('content', color)

    return () => {
      const current = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
      if (!current) return
      if (created) {
        current.remove()
        return
      }
      current.setAttribute('content', ONDA_DEFAULT_THEME_COLOR)
    }
  }, [backgroundColor])

  return null
}
