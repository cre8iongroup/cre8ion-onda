import { NextResponse } from 'next/server'
import {
  assertCorrectFirebaseProject,
  getAdminStorage,
  REQUIRED_FIREBASE_PROJECT_ID,
  resolveFirebaseStorageBucket,
} from '@/lib/firebase/admin'
import { getPublicAppOrigin, PRODUCTION_PUBLIC_ORIGIN } from '@/lib/attendee/urls'

/**
 * GET /api/health
 * Liveness + loud Firebase project guard (cre8ion-onda vs -503301).
 * Also reports Storage bucket resolution (name only) so App Hosting env
 * mismatches are visible without opening Cloud Logging.
 */
export async function GET() {
  try {
    const { projectId, databaseHost } = assertCorrectFirebaseProject()
    const { bucket: storageBucket, source: storageBucketSource } =
      resolveFirebaseStorageBucket()

    let storageBucketExists: boolean | null = null
    let storageBucketError: string | null = null
    if (storageBucket) {
      try {
        const [exists] = await getAdminStorage().bucket(storageBucket).exists()
        storageBucketExists = exists
      } catch (err) {
        storageBucketExists = false
        storageBucketError = err instanceof Error ? err.message : String(err)
      }
    }

    const publicAppOrigin = getPublicAppOrigin()
    const publicAppOriginIsLocalhost = /localhost|127\.0\.0\.1/.test(publicAppOrigin)

    return NextResponse.json({
      status: 'ok',
      service: 'onda',
      firebaseProjectId: projectId,
      databaseHost,
      requiredFirebaseProjectId: REQUIRED_FIREBASE_PROJECT_ID,
      // Advisory — does not flip status (Electron unlock requires status===ok).
      storageBucket: storageBucket ?? null,
      storageBucketSource: storageBucketSource ?? null,
      storageBucketExists,
      storageBucketError,
      // QR + preview links encode against this origin.
      publicAppOrigin,
      publicAppOriginExpected: PRODUCTION_PUBLIC_ORIGIN,
      publicAppOriginIsLocalhost,
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
