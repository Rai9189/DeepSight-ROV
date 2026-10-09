import { requireAuth } from '@/lib/auth-utils'
import Header from '@/components/layout/Header'
import HistoricalContent from '@/components/historical/HistoricalContent'

export default async function HistoricalPage() {
  await requireAuth()

  return (
    <>
      <Header
        title="Trends"
        subtitle="Water quality and fish counts across missions"
      />
      <main className="px-4 mt-4">
        <HistoricalContent />
      </main>
    </>
  )
}