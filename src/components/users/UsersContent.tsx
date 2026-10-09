'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, KeyRound, Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { useUsersPagination, type User } from '@/hooks/useUsersPagination'
import UserDialog from '@/components/users/UserDialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm'
const field = 'h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100'
const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 disabled:pointer-events-none disabled:opacity-30'
const btnSecondary = 'h-9 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const initials = (name: string) => name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?'
const missions = (n: number) => `${n} mission${n === 1 ? '' : 's'}`

// Shown once after adding a user or resetting a password — the server never returns it again,
// so only the explicit button closes it (no Esc, outside click or ×)
function TemporaryPassword({ value, onClose }: { value: { name: string; password: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value.password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy — select the password and copy it manually")
    }
  }
  return (
    <Dialog open={!!value}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onEscapeKeyDown={e => e.preventDefault()}
        onPointerDownOutside={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Temporary password for {value?.name}</DialogTitle>
          <DialogDescription>
            Share it with them yourself. It’s shown only now; they’ll choose their own password the first time they sign in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1.5 pl-3">
          <code className="min-w-0 flex-1 select-all truncate font-mono text-base text-gray-900">{value?.password}</code>
          <button onClick={copy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50">
            {copied ? <><Check className="h-4 w-4 text-green-600" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
          </button>
        </div>
        <DialogFooter>
          <button onClick={() => { setCopied(false); onClose() }} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
            I’ve copied it
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function UsersContent({ currentUserId }: { currentUserId: string }) {
  const {
    users, total, isLoading, error, hasMore, loadMore, reload, removeFromList,
    role, setRole, search, setSearch, sort, setSort,
  } = useUsersPagination()

  const [editing, setEditing] = useState<{ user: User | null } | null>(null) // { user: null } = add
  const [deleting, setDeleting] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)
  const [tempPassword, setTempPassword] = useState<{ name: string; password: string } | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      const res = await apiClient.delete<{ message: string }>(`/api/users/${deleting.id}`)
      removeFromList(deleting.id)
      toast.success(res?.message || 'User deleted')
      setDeleting(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the user")
    } finally {
      setBusy(false)
    }
  }

  const confirmReset = async () => {
    if (!resetting) return
    setBusy(true)
    try {
      const res = await apiClient.post<{ temporaryPassword: string }>(`/api/users/${resetting.id}/reset-password`)
      setTempPassword({ name: resetting.fullName, password: res.temporaryPassword })
      setResetting(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reset the password")
    } finally {
      setBusy(false)
    }
  }

  const filtered = !!(search.trim() || role)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search users"
            className={`${field} w-full pl-9`}
          />
        </div>
        <select value={role} onChange={e => setRole(e.target.value)} aria-label="Role" className={field}>
          <option value="">All roles</option>
          <option value="ADMIN">Admins</option>
          <option value="USER">Users</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as 'asc' | 'desc')} aria-label="Sort" className={field}>
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
        <button
          onClick={() => setEditing({ user: null })}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
        >
          <Plus className="h-4 w-4" /> Add user
        </button>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="flex items-baseline gap-2 border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-gray-900">{filtered ? 'Matching users' : 'All users'}</h2>
          <span className="text-xs text-gray-500">{total}</span>
        </div>

        {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-5 py-2.5 text-sm text-red-700">{error}</p>}

        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
            {isLoading ? (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
            ) : (
              <>
                <Users className="mb-3 h-7 w-7 text-gray-300" />
                <p className="text-base font-semibold text-gray-700">{filtered ? 'No users match' : 'No users yet'}</p>
                {filtered && <p className="mt-1 text-sm text-gray-500">Try another name, email or role.</p>}
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-5 py-2.5 text-xs font-medium text-gray-500">Name</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-500">Email</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-500">Phone</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-500">Role</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-500">Added</th>
                  <th className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => {
                  const isSelf = u.id === currentUserId
                  return (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                            {initials(u.fullName)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-gray-900">
                              {u.fullName}
                              {isSelf && <span className="ml-1.5 text-xs font-normal text-gray-500">(you)</span>}
                            </p>
                            {u.mustChangePassword && <p className="text-xs text-amber-700">Hasn’t set a password yet</p>}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-700">{u.email}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-700">{u.phoneNumber || '—'}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.role === 'ADMIN' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {u.role === 'ADMIN' ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-500">{fmtDate(u.createdAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-0.5">
                          <button onClick={() => setEditing({ user: u })} className={iconBtn} aria-label={`Edit ${u.fullName}`} title="Edit">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => setResetting(u)} disabled={isSelf} className={iconBtn} aria-label={`Reset password for ${u.fullName}`} title={isSelf ? 'Use Change password in your profile menu' : 'Reset password'}>
                            <KeyRound className="h-4 w-4" />
                          </button>
                          <button onClick={() => setDeleting(u)} disabled={isSelf} className={`${iconBtn} hover:bg-red-50 hover:text-red-600`} aria-label={`Delete ${u.fullName}`} title={isSelf ? "You can't delete your own account" : 'Delete'}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center border-t border-gray-100 py-3">
            <button onClick={loadMore} disabled={isLoading} className={btnSecondary}>
              {isLoading ? 'Loading…' : `Show more (${users.length} of ${total})`}
            </button>
          </div>
        )}
      </div>

      <UserDialog
        open={!!editing}
        user={editing?.user ?? null}
        isSelf={editing?.user?.id === currentUserId}
        onClose={() => setEditing(null)}
        onSaved={reload}
        onCreated={(name, password) => setTempPassword({ name, password })}
      />

      <TemporaryPassword value={tempPassword} onClose={() => setTempPassword(null)} />

      {/* Reset password */}
      <Dialog open={!!resetting} onOpenChange={o => { if (!o && !busy) setResetting(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Reset password?</DialogTitle>
            <DialogDescription>
              {resetting && <><span className="font-medium text-gray-900">{resetting.fullName}</span> gets a new temporary password and must choose their own the next time they sign in. Their current password stops working.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button onClick={() => setResetting(null)} disabled={busy} className={btnSecondary}>Cancel</button>
            <button onClick={confirmReset} disabled={busy} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70">
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleting} onOpenChange={o => { if (!o && !busy) setDeleting(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Delete user?</DialogTitle>
            <DialogDescription>
              {deleting && (
                <>
                  <span className="font-medium text-gray-900">{deleting.fullName}</span> ({deleting.email}) will no longer be able to sign in.{' '}
                  {deleting.missionCount
                    ? <>Their {missions(deleting.missionCount)} will be moved to your account, so no data is lost.</>
                    : 'They have no missions.'}{' '}
                  This can’t be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button onClick={() => setDeleting(null)} disabled={busy} className={btnSecondary}>Cancel</button>
            <button onClick={confirmDelete} disabled={busy} className="h-9 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-70">
              {busy ? 'Deleting…' : 'Delete user'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
