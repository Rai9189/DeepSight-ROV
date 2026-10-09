import { requireAuth } from '@/lib/auth-utils'
import Header from '@/components/layout/Header'
import AnalyticsContent from '@/components/analytics/AnalyticsContent'

export default async function AnalyticsPage() {
  await requireAuth()

  return (
    <>
      <Header title="Analytics" subtitle="Fish detection and water quality per mission" />
      <main className="px-4 mt-4">
        <AnalyticsContent />
      </main>
    </>
  )
}