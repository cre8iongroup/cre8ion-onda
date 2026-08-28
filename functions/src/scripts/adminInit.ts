/**
 * Self-contained Firebase Admin init for standalone functions/ scripts.
 *
 * Does NOT import from the root Next.js lib/ tree (no @/ path aliases).
 * Uses Application Default Credentials when GOOGLE_APPLICATION_CREDENTIALS is set;
 * Firestore emulator works with FIRESTORE_EMULATOR_HOST and no credentials.
 */
import * as admin from 'firebase-admin'

const DEFAULT_PROJECT_ID = 'cre8ion-onda'

export function getScriptFirestore(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    const projectId =
      process.env.GCLOUD_PROJECT?.trim() ||
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      process.env.FIREBASE_PROJECT_ID?.trim() ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
      DEFAULT_PROJECT_ID

    admin.initializeApp({ projectId })

    console.info('[script] firebase-admin initialized', {
      projectId,
      firestoreEmulator: process.env.FIRESTORE_EMULATOR_HOST ?? null,
      credentialSource: process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? 'GOOGLE_APPLICATION_CREDENTIALS'
        : process.env.FIRESTORE_EMULATOR_HOST
          ? 'emulator (no credentials)'
          : 'applicationDefault()',
    })
  }

  return admin.firestore()
}
