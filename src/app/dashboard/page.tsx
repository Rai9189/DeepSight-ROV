import { requireAuth } from '@/lib/auth-utils'
import Header from '@/components/layout/Header'
import DashboardContent from '@/components/dashboard/DashboardContent'

export const metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const session = await requireAuth()

  return (
    <>
      <Header title="Dashboard" subtitle={`Welcome back, ${session.user.fullName}`} />
      <main className="px-4 py-4 lg:px-6">
        <DashboardContent />
      </main>
    </>
  )
}