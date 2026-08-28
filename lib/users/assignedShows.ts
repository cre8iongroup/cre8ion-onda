import { doc, updateDoc } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import type { BaseRole } from '@/types'

export function validateReviewerAssignedShows(
  baseRole: BaseRole,
  assignedShows: string[],
): string | null {
  if (baseRole === 'reviewer' && assignedShows.length === 0) {
    return 'Reviewers must be assigned to at least one show.'
  }
  return null
}

export async function setUserAssignedShows(
  userId: string,
  assignedShows: string[],
): Promise<void> {
  const fs = getClientFirestore()
  await updateDoc(doc(fs, 'users', userId), { assignedShows })
}

export async function addShowToUserAssignedShows(
  userId: string,
  currentAssignedShows: string[],
  showId: string,
): Promise<void> {
  if (currentAssignedShows.includes(showId)) return
  await setUserAssignedShows(userId, [...currentAssignedShows, showId])
}

export async function removeShowFromUserAssignedShows(
  userId: string,
  currentAssignedShows: string[],
  showId: string,
  baseRole: BaseRole,
): Promise<void> {
  const nextAssignedShows = currentAssignedShows.filter((id) => id !== showId)
  const validationError = validateReviewerAssignedShows(baseRole, nextAssignedShows)
  if (validationError) {
    throw new Error(validationError)
  }
  await setUserAssignedShows(userId, nextAssignedShows)
}
