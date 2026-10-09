import { requireAuth } from '@/lib/auth-utils'
import Header from '@/components/layout/Header'
import AnalyticsContent from '@/components/analytics/AnalyticsContent'

export const metadata = { title: 'Mission Report' }

export default async function AnalyticsPage() {
  await requireAuth()

  return (
    <>
      <Header title="Mission Report" subtitle="Fish detection and water quality for one mission" />
      <main className="px-4 py-4 lg:px-6">
        <AnalyticsContent />
      </main>
    </>
  )
}