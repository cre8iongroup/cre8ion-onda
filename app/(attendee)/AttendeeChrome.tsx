import type { CSSProperties, ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
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

/**
 * Restricted markdown for show legal notices: paragraphs, bold, italic, links,
 * line breaks only (matches LegalNoticePanel / ShowBranding.legalNotice docs).
 */
export function LegalNoticeMarkdown({ source }: { source: string }) {
  return (
    <div className="attendee-legal-notice">
      <Markdown
        remarkPlugins={[remarkBreaks]}
        allowedElements={['p', 'a', 'strong', 'em', 'br']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {source}
      </Markdown>
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
      {legalNotice?.trim() ? <LegalNoticeMarkdown source={legalNotice.trim()} /> : null}
    </footer>
  )
}
