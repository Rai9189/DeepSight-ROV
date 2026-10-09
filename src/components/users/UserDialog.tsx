'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import type { User } from '@/hooks/useUsersPagination'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Form = { fullName: string; email: string; phoneNumber: string; role: 'USER' | 'ADMIN' }
const EMPTY: Form = { fullName: '', email: '', phoneNumber: '', role: 'USER' }

// What each role can actually do (matches the admin-only endpoints in the backend)
const ROLES: Array<{ value: Form['role']; label: string; text: string }> = [
  { value: 'USER', label: 'User', text: 'Runs missions and views all data' },
  { value: 'ADMIN', label: 'Admin', text: 'Also manages users and deletes recordings and missions' },
]

// Phone is typed after a fixed "+62": digits only, shown as 813-8208-3838.
// Pasted 0813… / +62 813… / 62-813… lose the leading 0 or 62.
// Same rule as check_phone in the backend: 8 then 8–11 digits (9–12 after +62)
const MIN_PHONE_DIGITS = 9
const MAX_PHONE_DIGITS = 12
function localPhone(raw: string) {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('62')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  d = d.slice(0, MAX_PHONE_DIGITS)
  return [d.slice(0, 3), d.slice(3, 7), d.slice(7)].filter(Boolean).join('-')
}

// "Too short" waits until the field is left, so it doesn't nag while typing
function phoneProblem(local: string, finished: boolean): string | null {
  const d = local.replace(/-/g, '')
  if (!d) return null
  if (d[0] !== '8') return 'Mobile numbers start with 8, e.g. 813-8208-3838'
  if (finished && d.length < MIN_PHONE_DIGITS) return `Too short — mobile numbers have ${MIN_PHONE_DIGITS} to ${MAX_PHONE_DIGITS} digits after +62`
  return null
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const inputCls = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-500'

// Add or edit a user. Passwords are never typed here: the server creates a temporary one (see onCreated).
export default function UserDialog({ open, user, isSelf, onClose, onSaved, onCreated }: {
  open: boolean
  user: User | null               // null = add
  isSelf: boolean
  onClose: () => void
  onSaved: () => void
  onCreated: (name: string, temporaryPassword: string) => void
}) {
  const [form, setForm] = useState<Form>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [phoneTouched, setPhoneTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setPhoneTouched(false)
    setForm(user ? { fullName: user.fullName, email: user.email, phoneNumber: localPhone(user.phoneNumber), role: user.role } : EMPTY)
  }, [open, user])

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  const phoneError = phoneProblem(form.phoneNumber, phoneTouched)
  const phoneInvalid = !!phoneProblem(form.phoneNumber, true)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (phoneInvalid) { setPhoneTouched(true); return }
    setSaving(true)
    setError(null)
    try {
      // Stored as +62-813-8208-3838, the format existing accounts already use
      const body = { ...form, phoneNumber: form.phoneNumber && `+62-${form.phoneNumber}` }
      if (user) {
        await apiClient.put(`/api/users/${user.id}`, body)
        toast.success('Changes saved')
        onSaved()
      } else {
        const res = await apiClient.post<{ temporaryPassword: string }>('/api/users', body)
        onSaved()
        onCreated(form.fullName, res.temporaryPassword)
      }
      onClose()
    } catch (err) {
      // Server validation (email taken, invalid phone, last admin…) stays in the form
      setError(err instanceof Error ? err.message : "Couldn't save the user")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !saving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{user ? 'Edit user' : 'Add user'}</DialogTitle>
          <DialogDescription>
            {user ? `Added ${fmtDate(user.createdAt)} · Updated ${fmtDate(user.updatedAt)}` : 'A temporary password is created for them.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Full name</span>
            <input required value={form.fullName} onChange={set('fullName')} autoComplete="off" className={`mt-1.5 ${inputCls}`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Email</span>
            <input required type="email" value={form.email} onChange={set('email')} autoComplete="off" className={`mt-1.5 ${inputCls}`} />
            <span className="mt-1 block text-xs text-gray-500">Used to sign in</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Phone</span>
            <div className={`mt-1.5 flex rounded-lg focus-within:ring-2 ${phoneError ? 'ring-1 ring-red-300 focus-within:ring-red-100' : 'focus-within:ring-blue-100'}`}>
              <span className="flex items-center rounded-l-lg border border-r-0 border-gray-200 bg-gray-50 px-3 text-sm text-gray-600">+62</span>
              <input
                required
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                value={form.phoneNumber}
                onChange={e => setForm(f => ({ ...f, phoneNumber: localPhone(e.target.value) }))}
                onBlur={() => setPhoneTouched(true)}
                aria-invalid={!!phoneError}
                aria-describedby="phone-hint"
                placeholder="813-8208-3838"
                className={`${inputCls} rounded-l-none focus-visible:ring-0`}
              />
            </div>
            <span id="phone-hint" className={`mt-1 block text-xs ${phoneError ? 'text-red-600' : 'text-gray-500'}`}>
              {phoneError ?? 'Indonesian mobile number'}
            </span>
          </label>

          <fieldset disabled={isSelf}>
            <legend className="text-sm font-medium text-gray-700">Role</legend>
            <div className="mt-1.5 space-y-2">
              {ROLES.map(r => (
                <label
                  key={r.value}
                  className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-100 ${form.role === r.value ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'} ${isSelf ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    checked={form.role === r.value}
                    onChange={() => setForm(f => ({ ...f, role: r.value }))}
                    className="mt-0.5 accent-blue-600"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">{r.label}</span>
                    <span className="block text-xs text-gray-500">{r.text}</span>
                  </span>
                </label>
              ))}
            </div>
            {isSelf && <p className="mt-1.5 text-xs text-gray-500">You can’t change your own role.</p>}
          </fieldset>

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <DialogFooter>
            <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving || phoneInvalid} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70">
              {saving ? 'Saving…' : user ? 'Save changes' : 'Add user'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
