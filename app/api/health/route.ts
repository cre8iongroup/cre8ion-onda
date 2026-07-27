import { NextRequest, NextResponse } from 'next/server'
import {
  assertCorrectFirebaseProject,
  REQUIRED_FIREBASE_PROJECT_ID,
} from '@/lib/firebase/admin'

/**
 * GET /api/health
 * Liveness + loud Firebase project guard (cre8ion-onda vs -503301).
 */
export async function GET() {
  try {
    const { projectId, databaseHost } = assertCorrectFirebaseProject()
    return NextResponse.json({
      status: 'ok',
      service: 'onda',
      firebaseProjectId: projectId,
      databaseHost,
      requiredFirebaseProjectId: REQUIRED_FIREBASE_PROJECT_ID,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[health] Firebase project check failed:', message)
    return NextResponse.json(
      {
        status: 'error',
        service: 'onda',
        error: message,
        requiredFirebaseProjectId: REQUIRED_FIREBASE_PROJECT_ID,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
