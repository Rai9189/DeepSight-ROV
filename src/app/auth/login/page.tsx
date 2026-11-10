import { getAuthSession } from '@/lib/auth-utils'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/auth/LoginForm'

export const metadata = {
  title: 'Sign in',
  description: 'Sign in to DeepSight ROV',
}

export default async function LoginPage() {
  /**
   * PERUBAHAN:
   * Sebelum: getServerSession(authOptions) → Session NextAuth
   * Sesudah: getAuthSession() → decode JWT dari cookie
   */
  const session = await getAuthSession()
  if (session) redirect('/dashboard')

  return <LoginForm />
}