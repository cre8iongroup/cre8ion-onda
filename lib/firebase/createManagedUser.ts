/**
 * Create a managed Auth user without disrupting the current admin session.
 *
 * Uses Identity Toolkit REST signUp (web API key) instead of Admin SDK so
 * local/dev works without GOOGLE_APPLICATION_CREDENTIALS. The admin remains
 * signed in via the Firebase client SDK and writes the Firestore user doc.
 */
const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1'

function apiKey(): string {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  if (!key) throw new Error('Missing NEXT_PUBLIC_FIREBASE_API_KEY')
  return key
}

export async function signUpAuthUser(email: string, password: string): Promise<{
  uid: string
  idToken: string
}> {
  const res = await fetch(`${IDENTITY_TOOLKIT}/accounts:signUp?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    const code = data?.error?.message || 'UNKNOWN'
    throw new Error(mapIdentityError(code))
  }
  return { uid: data.localId as string, idToken: data.idToken as string }
}

export async function deleteAuthUserByIdToken(idToken: string): Promise<void> {
  await fetch(`${IDENTITY_TOOLKIT}/accounts:delete?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
}

export function generateTempPassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

function mapIdentityError(code: string): string {
  switch (code) {
    case 'EMAIL_EXISTS':
      return 'An account with this email already exists.'
    case 'INVALID_EMAIL':
      return 'That email address is invalid.'
    case 'WEAK_PASSWORD : Password should be at least 6 characters':
    case 'WEAK_PASSWORD':
      return 'Password is too weak. Use at least 6 characters.'
    case 'OPERATION_NOT_ALLOWED':
      return 'Email/password accounts are disabled in Firebase Auth.'
    default:
      return `Failed to create Auth account (${code}).`
  }
}
