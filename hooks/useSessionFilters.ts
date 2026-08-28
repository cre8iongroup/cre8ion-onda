'use client'

import { useMemo, useState } from 'react'
import {
  filterSessions,
  getSessionDateOptions,
  sessionFiltersActive,
  type SessionListFilters,
  type TimeBucket,
} from '@/lib/sessions/sessionFilters'
import type { ReviewStatus, SessionDoc, WithId } from '@/types'

type Options = {
  getReviewStatus?: (session: WithId<SessionDoc>) => ReviewStatus
}

export function useSessionFilters(sessions: WithId<SessionDoc>[], options: Options = {}) {
  const [search, setSearch] = useState('')
  const [roomId, setRoomId] = useState('')
  const [dateKey, setDateKey] = useState('')
  const [timeBucket, setTimeBucket] = useState<'' | TimeBucket>('')
  const [reviewStatus, setReviewStatus] = useState<'' | ReviewStatus>('')

  const filters: SessionListFilters = useMemo(
    () => ({
      search,
      roomId,
      dateKey,
      timeBucket,
      ...(options.getReviewStatus ? { reviewStatus } : {}),
    }),
    [search, roomId, dateKey, timeBucket, reviewStatus, options.getReviewStatus],
  )

  const dateOptions = useMemo(() => getSessionDateOptions(sessions), [sessions])

  const filteredSessions = useMemo(
    () => filterSessions(sessions, filters, options.getReviewStatus),
    [sessions, filters, options.getReviewStatus],
  )

  const filtersActive = useMemo(() => sessionFiltersActive(filters), [filters])

  function clearFilters() {
    setSearch('')
    setRoomId('')
    setDateKey('')
    setTimeBucket('')
    setReviewStatus('')
  }

  return {
    search,
    setSearch,
    roomId,
    setRoomId,
    dateKey,
    setDateKey,
    timeBucket,
    setTimeBucket,
    reviewStatus,
    setReviewStatus,
    dateOptions,
    filteredSessions,
    filtersActive,
    clearFilters,
  }
}
