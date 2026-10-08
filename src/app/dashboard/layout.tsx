import { cookies } from 'next/headers'
import { requireAuth } from '@/lib/auth-utils'
import Sidebar from '@/components/layout/Sidebar'
import { SIDEBAR_COOKIE } from '@/lib/sidebar'
import SWRProvider from '@/components/providers/SWRProvider'
import { CurrentUserProvider } from '@/components/layout/UserMenu'

/**
 * PERUBAHAN:
 * requireAuth() sekarang baca JWT dari cookie, bukan NextAuth session.
 * Tipe AuthSession kompatibel — session.user.fullName, session.user.role dst tetap sama.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth()
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === '1'

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar session={session} defaultCollapsed={collapsed} />
      <div className="dashboard-content">
        <main className="p-0 lg:p-0">
          <CurrentUserProvider user={session.user}>
            <SWRProvider>{children}</SWRProvider>
          </CurrentUserProvider>
        </main>
      </div>
    </div>
  )
}