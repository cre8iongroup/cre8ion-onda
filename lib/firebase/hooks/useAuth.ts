'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { getClientAuth, getClientFirestore } from '@/lib/firebase/client'
import { resolveCapabilities } from '@/lib/permissions/check'
import type { UserDoc, Capabilities } from '@/types'

export interface AuthState {
  user: User | null
  userDoc: UserDoc | null
  capabilities: Capabilities | null
  loading: boolean
  error: string | null
}

export interface AuthActions {
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

const DEFAULT_CAPABILITIES: Capabilities = {
  canCreateShows:        false,
  canEditShows:          false,
  canManageUsers:        false,
  canAccessTechPanel:    false,
  canControlLiveFeed:    false,
  canViewPrivatePreview: false,
  canApproveTranscripts: false,
  canPublishSessions:    false,
  canExportTranscripts:  false,
  canManageBranding:     false,
  canManageOutputLayouts:false,
  canDownloadQr:         false,
}

export function useAuth(): AuthState & AuthActions {
  const [user, setUser]         = useState<User | null>(null)
  const [userDoc, setUserDoc]   = useState<UserDoc | null>(null)
  const [capabilities, setCaps] = useState<Capabilities | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    const auth = getClientAuth()
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setError(null)
      if (!firebaseUser) {
        setUser(null)
        setUserDoc(null)
        setCaps(null)
        setLoading(false)
        return
      }

      setUser(firebaseUser)

      try {
        const fs = getClientFirestore()
        const docRef = doc(fs, 'users', firebaseUser.uid)
        const docSnap = await getDoc(docRef)

        if (docSnap.exists()) {
          const data = docSnap.data() as UserDoc
          setUserDoc(data)
          setCaps(resolveCapabilities(data))
        } else {
          setUserDoc(null)
          setCaps(DEFAULT_CAPABILITIES)
          console.warn('useAuth: no user doc found for uid', firebaseUser.uid)
        }
      } catch (err) {
        console.error('useAuth: failed to load user doc', err)
        setError('Failed to load user profile. Please refresh.')
        setCaps(DEFAULT_CAPABILITIES)
      } finally {
        setLoading(false)
      }
    })

    return () => unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null)
    setLoading(true)
    try {
      const auth = getClientAuth()
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err: any) {
      setLoading(false)
      const msg = mapAuthError(err.code)
      setError(msg)
      throw new Error(msg)
    }
  }, [])

  const signOut = useCallback(async () => {
    const auth = getClientAuth()
    await firebaseSignOut(auth)
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    setError(null)
    try {
      const auth = getClientAuth()
      await sendPasswordResetEmail(auth, email)
    } catch (err: any) {
      const msg = mapAuthError(err.code)
      setError(msg)
      throw new Error(msg)
    }
  }, [])

  return { user, userDoc, capabilities, loading, error, signIn, signOut, resetPassword }
}

function mapAuthError(code: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.'
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your administrator.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    default:
      return 'Sign-in failed. Please try again.'
  }
}
