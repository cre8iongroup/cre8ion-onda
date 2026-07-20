'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'onda.tech.audioDeviceId'

export default function AudioDevicePicker({
  onDeviceChange,
}: {
  onDeviceChange?: (deviceId: string | null) => void
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')

  async function refreshDevices() {
    try {
      // Permission prompt unlocks device labels in most browsers
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setPermission('granted')

      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter((d) => d.kind === 'audioinput')
      setDevices(inputs)

      const saved = sessionStorage.getItem(STORAGE_KEY) || ''
      const next =
        (saved && inputs.some((d) => d.deviceId === saved) && saved) ||
        inputs[0]?.deviceId ||
        ''
      setSelected(next)
      if (next) sessionStorage.setItem(STORAGE_KEY, next)
      onDeviceChange?.(next || null)
      setError(null)
    } catch (err: any) {
      console.error('AudioDevicePicker:', err)
      setPermission('denied')
      setError(err?.message || 'Microphone permission denied.')
      onDeviceChange?.(null)
    }
  }

  useEffect(() => {
    refreshDevices()
    const handler = () => refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handler)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleChange(deviceId: string) {
    setSelected(deviceId)
    sessionStorage.setItem(STORAGE_KEY, deviceId)
    onDeviceChange?.(deviceId)
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <div className="flex items-center justify-between gap-4" style={{ marginBottom: 'var(--space-3)' }}>
        <h3 style={{ fontSize: 'var(--text-md)' }}>Audio input</h3>
        <button
          type="button"
          id="btn-refresh-audio-devices"
          className="btn btn-ghost btn-sm"
          onClick={refreshDevices}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      <div className="field">
        <label htmlFor="audio-device" className="label">
          Input device {permission === 'granted' ? '' : '(permission required)'}
        </label>
        <select
          id="audio-device"
          className="input"
          value={selected}
          onChange={(e) => handleChange(e.target.value)}
          disabled={devices.length === 0}
        >
          {devices.length === 0 && <option value="">No devices found</option>}
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
          Selection is saved for this browser tab. Recall Desktop SDK captures system audio separately —
          use this picker to confirm the correct mic is available on this machine.
        </p>
      </div>
    </div>
  )
}
