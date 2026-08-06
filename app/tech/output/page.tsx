import type { Metadata } from 'next'
import { Suspense } from 'react'
import OutputBuilderClient from './OutputBuilderClient'

export const metadata: Metadata = {
  title: 'Output Builder — Tech',
  description: 'Configure live caption output windows for a room',
}

export default function TechOutputPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading" />
        </div>
      }
    >
      <OutputBuilderClient />
    </Suspense>
  )
}
