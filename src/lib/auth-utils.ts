import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { decodeJWT } from '@/lib/jwt'

export interface AuthUser {
  id: string
  email: string
  fullName: string
  role: 'USER' | 'ADMIN'
  phoneNumber: string
  mustChangePassword: boolean
}

export interface AuthSession {
  user: AuthUser
}

export async function getAuthSession(): Promise<AuthSession | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    if (!token) return null
    const user = decodeJWT(token)
    if (!user) return null
    return { user }
  } catch {
    return null
  }
}

export async function requireAuth(): Promise<AuthSession> {
  const session = await getAuthSession()
  if (!session) redirect('/auth/login')
  // Temporary password from an admin: nothing else opens until the user picks their own
  // (the API refuses the same requests, see get_current_user in the backend)
  if (session.user.mustChangePassword) redirect('/auth/set-password')
  return session
}

export async function requireAdmin(): Promise<AuthSession> {
  const session = await requireAuth()
  if (session.user.role !== 'ADMIN') redirect('/dashboard')
  return session
}

export function hasRole(session: AuthSession | null, role: 'USER' | 'ADMIN'): boolean {
  return session?.user?.role === role
}