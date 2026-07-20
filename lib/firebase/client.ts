/**
 * Firebase Client SDK — browser-only singleton.
 *
 * Guards initialization so it never runs during SSR/build. All hooks that
 * use Firebase client SDK must be inside 'use client' components.
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  databaseURL:       process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? '',
}

export class FirebaseConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirebaseConfigError'
  }
}

function assertClientConfig() {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
    throw new FirebaseConfigError(
      'Firebase is not configured. Copy .env.example to .env.local and set the NEXT_PUBLIC_FIREBASE_* values from the Firebase console (Project settings → Your apps).'
    )
  }
}

// Singleton — Next.js hot-reload safe
function getFirebaseApp(): FirebaseApp {
  if (getApps().length) return getApp()
  assertClientConfig()
  return initializeApp(firebaseConfig)
}

// Lazy getters — evaluated on first call, safe for 'use client' components
export function getClientAuth() {
  const { getAuth } = require('firebase/auth')
  return getAuth(getFirebaseApp())
}

export function getClientFirestore() {
  const { getFirestore } = require('firebase/firestore')
  return getFirestore(getFirebaseApp())
}

export function getClientDatabase() {
  const { getDatabase } = require('firebase/database')
  return getDatabase(getFirebaseApp())
}

export function getClientStorage() {
  const { getStorage } = require('firebase/storage')
  return getStorage(getFirebaseApp())
}
