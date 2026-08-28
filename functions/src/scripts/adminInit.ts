/**
 * Self-contained Firebase Admin init for standalone functions/ scripts.
 *
 * Does NOT import from the root Next.js lib/ tree (no @/ path aliases).
 * Uses Application Default Credentials when GOOGLE_APPLICATION_CREDENTIALS is set;
 * Firestore emulator works with FIRESTORE_EMULATOR_HOST and no credentials.
 */
import * as admin from 'firebase-admin'
import type { Database } from 'firebase-admin/database'
import type { Firestore } from 'firebase-admin/firestore'
import type { Storage } from 'firebase-admin/storage'

export const DEFAULT_PROJECT_ID = 'cre8ion-onda'

function resolveProjectId(): string {
  return (
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    DEFAULT_PROJECT_ID
  )
}

function resolveDatabaseUrl(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim() ||
    process.env.FIREBASE_DATABASE_URL?.trim() ||
    undefined
  )
}

function resolveStorageBucket(): string | undefined {
  return (
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
    undefined
  )
}

function ensureApp(): admin.app.App {
  if (admin.apps.length) return admin.app()

  const projectId = resolveProjectId()
  const databaseURL = resolveDatabaseUrl()
  const storageBucket = resolveStorageBucket()

  admin.initializeApp({
    projectId,
    ...(databaseURL ? { databaseURL } : {}),
    ...(storageBucket ? { storageBucket } : {}),
  })

  console.info('[script] firebase-admin initialized', {
    projectId,
    databaseURL: databaseURL ?? '(unset — RTDB unavailable)',
    storageBucket: storageBucket ?? '(unset — Storage checks may fail)',
    firestoreEmulator: process.env.FIRESTORE_EMULATOR_HOST ?? null,
    credentialSource: process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? 'GOOGLE_APPLICATION_CREDENTIALS'
      : process.env.FIRESTORE_EMULATOR_HOST
        ? 'emulator (no credentials)'
        : 'applicationDefault()',
  })

  return admin.app()
}

export function getScriptProjectId(): string {
  ensureApp()
  return resolveProjectId()
}

export function getScriptFirestore(): Firestore {
  return admin.firestore(ensureApp())
}

export function getScriptDatabase(): Database | null {
  const databaseURL = resolveDatabaseUrl()
  if (!databaseURL) {
    return null
  }
  return admin.database(ensureApp())
}

export function getScriptStorage(): Storage {
  return admin.storage(ensureApp())
}
