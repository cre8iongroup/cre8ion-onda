'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Network diagnostics deferred — room-scoped revisit later. Hidden from Tech IA. */
export default function TechNetworkPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/tech')
  }, [router])

  return (
    <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
      <span className="spinner" aria-label="Redirecting" />
    </div>
  )
}
