'use client'

import Image from 'next/image'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoginData } from '@/types/auth'
import { Anchor, Eye, EyeOff, Loader2 } from 'lucide-react'
import { ApiError, authHelper, isApiStatus } from '@/lib/api-client'
import { safeCallbackUrl } from '@/lib/safe-callback'

export default function LoginForm() {
  const [formData, setFormData] = useState<LoginData>({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.email.trim() || !formData.password.trim()) {
      setError('Email and password are required')
      return
    }
    setLoading(true)
    setError('')
    try {
      const user = await authHelper.login(formData.email, formData.password)
      // A temporary password from an admin must be replaced before anything else
      router.replace(user.mustChangePassword
        ? `/auth/set-password?callbackUrl=${encodeURIComponent(safeCallbackUrl())}`
        : safeCallbackUrl())
    } catch (err: unknown) {
      setError(isApiStatus(err, 401)
        ? 'Invalid email or password'
        // 422: the browser accepted the email (e.g. "a@b") but the backend did not
        : isApiStatus(err, 422) ? 'Enter a valid email address'
        : err instanceof ApiError ? err.message : 'Cannot reach the server. Check your connection and try again.')
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    if (error) setError('')
  }

  const inputCls = 'w-full h-11 px-4 border border-gray-300 rounded-lg bg-white placeholder:text-gray-400 text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60 transition-colors'

  return (
    <div className="min-h-screen w-full bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-4xl rounded-2xl border border-gray-200 shadow-sm bg-white md:h-[560px] overflow-hidden">
        <div className="grid md:grid-cols-2 h-full">
          <div className="px-6 py-8 md:px-10 md:py-12 flex flex-col justify-center">
            <div className="mb-5 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600">
                <Anchor className="h-7 w-7 text-white" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">DeepSight ROV</h1>
              <p className="mt-1 text-sm text-gray-500">ROV monitoring dashboard · MSTP Teluk Awur, Jepara</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
                <input id="email" name="email" type="email" placeholder="you@example.com" value={formData.email} onChange={handleChange} disabled={loading}
                  className={inputCls} autoComplete="email" autoFocus />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium text-gray-700">Password</label>
                <div className="relative">
                  <input id="password" name="password" type={showPassword ? 'text' : 'password'} placeholder="Enter your password" value={formData.password} onChange={handleChange} disabled={loading}
                    className={`${inputCls} pr-12`} autoComplete="current-password" />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 transition-colors" onClick={() => setShowPassword(!showPassword)} disabled={loading} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="animate-in fade-in slide-in-from-bottom-1 duration-150 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              )}

              <button type="submit" disabled={loading}
                className="w-full h-11 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed transition-[background-color,transform] duration-100 ease-out">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <p className="text-center text-sm text-gray-500">Forgot your password? Ask an admin to reset it.</p>
            </form>
          </div>

          <div className="relative hidden md:block h-full">
            <Image src="/hero.jpg" alt="DeepSight ROV" fill className="object-cover" priority sizes="50vw" />
          </div>
        </div>
      </div>
    </div>
  )
}
