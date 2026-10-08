import { requireAuth } from '@/lib/auth-utils'
import Header from '@/components/layout/Header'
import HistoricalContent from '@/components/historical/HistoricalContent'

export default async function HistoricalPage() {
  await requireAuth()

  return (
    <>
      <Header
        title="Historical"
        subtitle="Past missions and reports"
      />
      <main className="p-0 lg:px-4 mt-4">
        <HistoricalContent />
      </main>
    </>
  )
}