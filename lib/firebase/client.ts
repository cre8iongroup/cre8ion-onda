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

// Singleton — Next.js hot-reload safe
function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig)
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

// Named exports for convenience — only call these in 'use client' context
export const app       = typeof window !== 'undefined' ? getFirebaseApp() : null
