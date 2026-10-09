'use client'

import { useRouter } from 'next/navigation'
import { Anchor } from 'lucide-react'
import { authHelper } from '@/lib/api-client'
import PasswordForm from '@/components/auth/PasswordForm'
import { safeCallbackUrl } from '@/lib/safe-callback'

export default function SetPasswordCard({ name }: { name: string }) {
  const router = useRouter()
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white px-6 py-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600">
            <Anchor className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">Set your password</h1>
          <p className="mt-1 text-sm text-gray-500">
            Welcome, {name}. You signed in with a temporary password from an admin — choose your own to continue.
          </p>
        </div>
        <PasswordForm
          currentLabel="Temporary password"
          submitLabel="Set password and continue"
          onDone={() => { router.replace(safeCallbackUrl()); router.refresh() }}
        />
        <button onClick={() => authHelper.logout()} className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-700">
          Sign out
        </button>
      </div>
    </div>
  )
}
