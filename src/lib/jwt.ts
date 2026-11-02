import type { AuthUser } from '@/lib/auth-utils'

// Reads the claims only; the backend verifies the signature on every API call.
// Lives apart from auth-utils because middleware can't import next/headers.
export function decodeJWT(token: string): AuthUser | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const decoded = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    const data = JSON.parse(decoded)
    if (data.exp && Date.now() / 1000 > data.exp) return null
    return {
      id: data.sub || '',
      email: data.email || '',
      fullName: data.fullName || data.full_name || data.email || '',
      role: data.role || 'USER',
      phoneNumber: data.phoneNumber || data.phone_number || '',
      mustChangePassword: data.mustChangePassword === true,
    }
  } catch {
    return null
  }
}
