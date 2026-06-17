/**
 * Firebase Admin SDK — server-side only.
 *
 * Lazy initialization: getAdmin*() functions initialize on first call,
 * not at module load time. This prevents build-time errors when Firebase
 * env vars are not set in the CI/build environment.
 *
 * Authentication:
 *   - Production:  Application Default Credentials (automatic)
 *   - Local dev:   Set GOOGLE_APPLICATION_CREDENTIALS env var to service account JSON path
 */
import { initializeApp, getApps, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getDatabase, type Database } from 'firebase-admin/database'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getStorage, type Storage } from 'firebase-admin/storage'

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]
  return initializeApp({
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  })
}

// Lazy getters — safe to call inside API route handlers and server components
export function getAdminFirestore(): Firestore { return getFirestore(getAdminApp()) }
export function getAdminDatabase(): Database   { return getDatabase(getAdminApp()) }
export function getAdminAuth(): Auth           { return getAuth(getAdminApp()) }
export function getAdminStorage(): Storage     { return getStorage(getAdminApp()) }
