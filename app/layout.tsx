import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'

export const metadata: Metadata = {
  title: {
    default: 'Onda — Live Translation & AI Notes',
    template: '%s | Onda',
  },
  description: 'Real-time live translation, captions, and AI-powered session notes for live events.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Onda',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  // Required for branded attendee bg to paint under iOS status bar / home indicator.
  // Shells apply env(safe-area-inset-*) padding so content stays clear of the notch.
  // themeColor is the Onda default; attendee routes override <meta name="theme-color">
  // client-side from effective branding background (see AttendeeThemeColor).
  viewportFit: 'cover',
  themeColor: '#5b3aee',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* PWA iOS splash */}
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192x192.png" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
