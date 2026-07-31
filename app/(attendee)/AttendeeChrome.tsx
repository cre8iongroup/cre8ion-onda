import type { CSSProperties, ReactNode } from 'react'
import type { EffectiveBranding } from '@/types'
import './attendee.css'

export function brandingStyle(branding: EffectiveBranding): CSSProperties {
  const accent = branding.accentColors[0] || '#5b3aee'
  return {
    ['--attendee-bg' as string]: branding.backgroundColor,
    ['--attendee-text' as string]: branding.textColor,
    ['--attendee-accent' as string]: accent,
    ['--attendee-accent-2' as string]: branding.accentColors[1] || accent,
  }
}

export function AttendeeShell({
  branding,
  children,
}: {
  branding: EffectiveBranding
  children: ReactNode
}) {
  return (
    <div className="attendee-shell" style={brandingStyle(branding)}>
      <div className="attendee-inner">{children}</div>
    </div>
  )
}

export function AttendeeFooter({
  eventTitle,
  legalNotice,
}: {
  eventTitle: string
  legalNotice?: string
}) {
  return (
    <footer className="attendee-footer">
      <p>
        {eventTitle} · Powered by{' '}
        <a href="https://cre8ion.com" rel="noopener noreferrer">
          cre8ion Onda
        </a>
      </p>
      {legalNotice ? (
        <p style={{ marginTop: '0.75rem', whiteSpace: 'pre-wrap' }}>{legalNotice}</p>
      ) : null}
    </footer>
  )
}
