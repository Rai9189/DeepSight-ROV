import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/auth-utils'
import SetPasswordCard from '@/components/auth/SetPasswordCard'

export const metadata = { title: 'Set your password' }

// Reached after signing in with a temporary password (requireAuth sends everyone else to the dashboard)
export default async function SetPasswordPage() {
  const session = await getAuthSession()
  if (!session) redirect('/auth/login')
  if (!session.user.mustChangePassword) redirect('/dashboard')

  return <SetPasswordCard name={session.user.fullName} />
}
