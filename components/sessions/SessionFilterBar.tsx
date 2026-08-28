'use client'

import type { ReviewStatus, ShowRoom } from '@/types'
import { reviewStatusLabel } from '@/lib/review/reviewState'
import {
  TIME_BUCKET_LABELS,
  formatSessionDateLabel,
  type TimeBucket,
  type TimeSort,
} from '@/lib/sessions/sessionFilters'
import { sortRoomsByName } from '@/lib/rooms'
import { useMemo } from 'react'

type SessionFilterBarProps = {
  idPrefix: string
  search: string
  onSearchChange: (value: string) => void
  rooms: ShowRoom[]
  roomId: string
  onRoomIdChange: (value: string) => void
  dateOptions: string[]
  dateKey: string
  onDateKeyChange: (value: string) => void
  timeBucket: '' | TimeBucket
  onTimeBucketChange: (value: '' | TimeBucket) => void
  filtersActive: boolean
  onClearFilters: () => void
  showReviewStatusFilter?: boolean
  reviewStatus?: '' | ReviewStatus
  onReviewStatusChange?: (value: '' | ReviewStatus) => void
  showTimeSort?: boolean
  timeSort?: TimeSort
  onTimeSortChange?: (value: TimeSort) => void
}

export default function SessionFilterBar({
  idPrefix,
  search,
  onSearchChange,
  rooms,
  roomId,
  onRoomIdChange,
  dateOptions,
  dateKey,
  onDateKeyChange,
  timeBucket,
  onTimeBucketChange,
  filtersActive,
  onClearFilters,
  showReviewStatusFilter = false,
  reviewStatus = '',
  onReviewStatusChange,
  showTimeSort = false,
  timeSort = 'asc',
  onTimeSortChange,
}: SessionFilterBarProps) {
  const sortedRooms = useMemo(() => sortRoomsByName(rooms), [rooms])

  return (
    <div
      className="card"
      style={{
        padding: 'var(--space-3)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-2)',
        alignItems: 'flex-end',
      }}
    >
      <div className="field" style={{ margin: 0, flex: '1 1 12rem', minWidth: 0 }}>
        <label className="label" htmlFor={`${idPrefix}-search`}>
          Search
        </label>
        <input
          id={`${idPrefix}-search`}
          className="input"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Session name…"
        />
      </div>
      <div className="field" style={{ margin: 0, flex: '1 1 10rem', minWidth: 0 }}>
        <label className="label" htmlFor={`${idPrefix}-room-filter`}>
          Room
        </label>
        <select
          id={`${idPrefix}-room-filter`}
          className="input"
          value={roomId}
          onChange={(e) => onRoomIdChange(e.target.value)}
        >
          <option value="">All rooms</option>
          {sortedRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ margin: 0, flex: '1 1 10rem', minWidth: 0 }}>
        <label className="label" htmlFor={`${idPrefix}-date-filter`}>
          Date
        </label>
        <select
          id={`${idPrefix}-date-filter`}
          className="input"
          value={dateKey}
          onChange={(e) => onDateKeyChange(e.target.value)}
        >
          <option value="">All dates</option>
          {dateOptions.map((k) => (
            <option key={k} value={k}>
              {formatSessionDateLabel(k)}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ margin: 0, flex: '1 1 10rem', minWidth: 0 }}>
        <label className="label" htmlFor={`${idPrefix}-time-filter`}>
          Time
        </label>
        <select
          id={`${idPrefix}-time-filter`}
          className="input"
          value={timeBucket}
          onChange={(e) => onTimeBucketChange(e.target.value as '' | TimeBucket)}
        >
          <option value="">All times</option>
          {(Object.keys(TIME_BUCKET_LABELS) as TimeBucket[]).map((b) => (
            <option key={b} value={b}>
              {TIME_BUCKET_LABELS[b]}
            </option>
          ))}
        </select>
      </div>
      {showReviewStatusFilter && onReviewStatusChange ? (
        <div className="field" style={{ margin: 0, flex: '1 1 10rem', minWidth: 0 }}>
          <label className="label" htmlFor={`${idPrefix}-review-status-filter`}>
            Review status
          </label>
          <select
            id={`${idPrefix}-review-status-filter`}
            className="input"
            value={reviewStatus}
            onChange={(e) => onReviewStatusChange(e.target.value as '' | ReviewStatus)}
          >
            <option value="">All statuses</option>
            <option value="needs_review">{reviewStatusLabel('needs_review')}</option>
            <option value="in_review">{reviewStatusLabel('in_review')}</option>
            <option value="approved">{reviewStatusLabel('approved')}</option>
            <option value="published">{reviewStatusLabel('published')}</option>
          </select>
        </div>
      ) : null}
      {showTimeSort && onTimeSortChange ? (
        <div className="field" style={{ margin: 0, flex: '0 1 9rem', minWidth: 0 }}>
          <label className="label" htmlFor={`${idPrefix}-time-sort`}>
            Sort within room
          </label>
          <select
            id={`${idPrefix}-time-sort`}
            className="input"
            value={timeSort}
            onChange={(e) => onTimeSortChange(e.target.value as TimeSort)}
          >
            <option value="asc">Earliest first</option>
            <option value="desc">Latest first</option>
          </select>
        </div>
      ) : null}
      {filtersActive ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClearFilters}
          style={{ alignSelf: 'flex-end' }}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  )
}
