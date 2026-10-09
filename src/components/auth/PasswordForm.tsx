'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { apiClient, userStorage, type AuthUser } from '@/lib/api-client'

const MIN_LENGTH = 8 // same as PASSWORD_MIN_LENGTH in the backend

const inputCls = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 disabled:opacity-60'

function PasswordField({ id, label, hint, value, onChange, autoComplete, autoFocus, disabled }: {
  id: string; label: string; hint?: string; value: string; onChange: (v: string) => void
  autoComplete: string; autoFocus?: boolean; disabled: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
      <div className="relative mt-1.5">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          required
          className={inputCls}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
        >
          {show ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

// Change your own password. Used by the forced "Set your password" page and the account menu dialog.
export default function PasswordForm({ currentLabel, submitLabel, onDone, onCancel }: {
  currentLabel: string
  submitLabel: string
  onDone: (user: AuthUser) => void
  onCancel?: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters`)
    if (next !== confirm) return setError('The new passwords don’t match')
    setSaving(true)
    setError(null)
    try {
      const res = await apiClient.post<{ user: AuthUser }>('/api/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      })
      userStorage.set(res.user) // the backend also set a fresh session cookie
      onDone(res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password")
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PasswordField id="current-password" label={currentLabel} value={current} onChange={setCurrent} autoComplete="current-password" autoFocus disabled={saving} />
      <PasswordField id="new-password" label="New password" hint={`At least ${MIN_LENGTH} characters`} value={next} onChange={setNext} autoComplete="new-password" disabled={saving} />
      <PasswordField id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={saving} />

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className="h-9 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
        )}
        <button type="submit" disabled={saving} className={`h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70 ${onCancel ? '' : 'w-full h-10'}`}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
