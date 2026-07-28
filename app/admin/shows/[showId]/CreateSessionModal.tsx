'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { addDoc, collection, doc, Timestamp, updateDoc } from 'firebase/firestore'
import { getClientFirestore } from '@/lib/firebase/client'
import type { SessionDoc, ShowRoom } from '@/types'
import {
  findRoomNameConflict,
  newRoomId,
  normalizeRoomName,
  sortRoomsByName,
} from '@/lib/rooms'

const CREATE_NEW_ROOM = '__create_new_room__'

const createSessionSchema = z.object({
  title: z.string().trim().min(2, 'Session title is required'),
  friendlyName: z.string().trim().min(2, 'Friendly name is required'),
  roomId: z.string().trim().min(1, 'Room is required'),
  scheduledStart: z.string().min(1, 'Start time is required'),
  scheduledEnd: z.string().min(1, 'End time is required'),
}).refine(
  (data) => new Date(data.scheduledEnd) > new Date(data.scheduledStart),
  { message: 'End time must be after start time', path: ['scheduledEnd'] }
)

type CreateSessionFormValues = z.infer<typeof createSessionSchema>

interface CreateSessionModalProps {
  open: boolean
  showId: string
  createdBy: string
  canCreate: boolean
  defaultLanguages: string[]
  rooms: ShowRoom[]
  onClose: () => void
  onCreated: (sessionId: string) => void
}

export default function CreateSessionModal({
  open,
  showId,
  createdBy,
  canCreate,
  defaultLanguages,
  rooms,
  onClose,
  onCreated,
}: CreateSessionModalProps) {
  const titleId = useId()
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const [inlineRoomName, setInlineRoomName] = useState('')
  const [creatingRoom, setCreatingRoom] = useState(false)

  const sortedRooms = sortRoomsByName(rooms)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<CreateSessionFormValues>({
    resolver: zodResolver(createSessionSchema),
    defaultValues: {
      title: '',
      friendlyName: '',
      roomId: '',
      scheduledStart: '',
      scheduledEnd: '',
    },
  })

  const roomIdValue = watch('roomId')
  const showInlineCreate = roomIdValue === CREATE_NEW_ROOM

  const { ref: titleRef, ...titleRegister } = register('title')

  useEffect(() => {
    if (!open) return
    reset({
      title: '',
      friendlyName: '',
      roomId: '',
      scheduledStart: '',
      scheduledEnd: '',
    })
    setInlineRoomName('')
    setCreatingRoom(false)
    const t = window.setTimeout(() => titleInputRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [open, reset])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting && !creatingRoom) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, isSubmitting, creatingRoom, onClose])

  if (!open) return null

  async function createRoomInline(): Promise<string | null> {
    const trimmed = normalizeRoomName(inlineRoomName)
    if (!trimmed) {
      setError('roomId', { message: 'Room name is required.' })
      return null
    }
    if (findRoomNameConflict(rooms, trimmed)) {
      setError('roomId', { message: 'A room with that name already exists.' })
      return null
    }
    const room: ShowRoom = { id: newRoomId(), name: trimmed }
    const next = [...rooms, room]
    setCreatingRoom(true)
    try {
      await updateDoc(doc(getClientFirestore(), 'shows', showId), { rooms: next })
      setValue('roomId', room.id, { shouldValidate: true })
      setInlineRoomName('')
      clearErrors('roomId')
      return room.id
    } catch (err: any) {
      console.error('CreateSessionModal: failed to create room', err)
      setError('roomId', { message: err?.message || 'Failed to create room.' })
      return null
    } finally {
      setCreatingRoom(false)
    }
  }

  async function onSubmit(values: CreateSessionFormValues) {
    if (!canCreate) {
      setError('root', { message: 'You do not have permission to create sessions.' })
      return
    }

    let roomId = values.roomId
    if (roomId === CREATE_NEW_ROOM) {
      const created = await createRoomInline()
      if (!created) return
      roomId = created
    }

    if (!roomId || roomId === CREATE_NEW_ROOM) {
      setError('roomId', { message: 'Select a room.' })
      return
    }

    try {
      const payload: SessionDoc = {
        title: values.title.trim(),
        friendlyName: values.friendlyName.trim(),
        roomId,
        scheduledStart: Timestamp.fromDate(new Date(values.scheduledStart)),
        scheduledEnd: Timestamp.fromDate(new Date(values.scheduledEnd)),
        languages: defaultLanguages.length ? defaultLanguages : ['en'],
        isDraft: true,
        feedState: 'standby',
        approvalState: {},
        createdAt: Timestamp.now(),
        createdBy,
      }

      const fs = getClientFirestore()
      const ref = await addDoc(collection(fs, 'shows', showId, 'sessions'), payload)
      onCreated(ref.id)
      onClose()
    } catch (err: any) {
      console.error('CreateSessionModal: failed to create session', err)
      setError('root', {
        message: err?.message || 'Failed to create session. Please try again.',
      })
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting && !creatingRoom) onClose()
      }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <h2 id={titleId} style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
              Create Session
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Assign each session to a room from this show&apos;s room list.
            </p>
          </div>
          <button
            type="button"
            id="btn-create-session-close"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isSubmitting || creatingRoom}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form className="form-group" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="field">
            <label htmlFor="session-title" className="label">Session title</label>
            <input
              id="session-title"
              className={`input ${errors.title ? 'error' : ''}`}
              placeholder="Opening Keynote"
              disabled={isSubmitting || creatingRoom}
              {...titleRegister}
              ref={(el) => {
                titleRef(el)
                titleInputRef.current = el
              }}
            />
            {errors.title && <p className="field-error">{errors.title.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="session-friendly" className="label">Friendly name</label>
            <input
              id="session-friendly"
              className={`input ${errors.friendlyName ? 'error' : ''}`}
              placeholder="Main Stage"
              disabled={isSubmitting || creatingRoom}
              {...register('friendlyName')}
            />
            {errors.friendlyName && <p className="field-error">{errors.friendlyName.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="session-room" className="label">Room</label>
            <select
              id="session-room"
              className={`input ${errors.roomId ? 'error' : ''}`}
              disabled={isSubmitting || creatingRoom}
              {...register('roomId')}
            >
              <option value="">Select a room…</option>
              {sortedRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
              <option value={CREATE_NEW_ROOM}>+ Create new room</option>
            </select>
            {showInlineCreate ? (
              <div style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
                <input
                  id="session-room-inline"
                  className={`input ${errors.roomId ? 'error' : ''}`}
                  placeholder="Room name (e.g. Room 207)"
                  value={inlineRoomName}
                  disabled={isSubmitting || creatingRoom}
                  onChange={(e) => setInlineRoomName(e.target.value)}
                />
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  Creates the room on this show, then assigns it to this session.
                </p>
              </div>
            ) : null}
            {errors.roomId && <p className="field-error">{errors.roomId.message}</p>}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="session-start" className="label">Scheduled start</label>
              <input
                id="session-start"
                type="datetime-local"
                className={`input ${errors.scheduledStart ? 'error' : ''}`}
                disabled={isSubmitting || creatingRoom}
                {...register('scheduledStart')}
              />
              {errors.scheduledStart && <p className="field-error">{errors.scheduledStart.message}</p>}
            </div>
            <div className="field">
              <label htmlFor="session-end" className="label">Scheduled end</label>
              <input
                id="session-end"
                type="datetime-local"
                className={`input ${errors.scheduledEnd ? 'error' : ''}`}
                disabled={isSubmitting || creatingRoom}
                {...register('scheduledEnd')}
              />
              {errors.scheduledEnd && <p className="field-error">{errors.scheduledEnd.message}</p>}
            </div>
          </div>

          {errors.root && (
            <div className="alert alert-error" role="alert">
              {errors.root.message}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              id="btn-create-session-cancel"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={isSubmitting || creatingRoom}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-create-session-submit"
              className="btn btn-primary"
              disabled={isSubmitting || creatingRoom || !canCreate}
            >
              {isSubmitting || creatingRoom ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Creating…
                </>
              ) : (
                'Create Session'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
