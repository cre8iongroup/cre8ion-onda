'use client'

import { reviewStatusLabel } from '@/lib/review/reviewState'
import { reviewStatusBadgeClass } from '@/lib/review/sessionReview'
import type { ReviewStatus } from '@/types'

export default function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className={`badge ${reviewStatusBadgeClass(status)}`}>
      {reviewStatusLabel(status)}
    </span>
  )
}
