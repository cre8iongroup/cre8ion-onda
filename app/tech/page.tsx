'use client'

import { Suspense } from 'react'
import RoomCheckInClient from './RoomCheckInClient'

export default function TechRoomCheckInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center" style={{ padding: 'var(--space-16)' }}>
          <span className="spinner" aria-label="Loading" />
        </div>
      }
    >
      <RoomCheckInClient />
    </Suspense>
  )
}
