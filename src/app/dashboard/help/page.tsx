import { requireAuth } from '@/lib/auth-utils'
import Header from '@/components/layout/Header'
import HelpContent from '@/components/help/HelpContent'

export const metadata = { title: 'Help' }

export default async function HelpPage() {
  await requireAuth()

  return (
    <>
      <Header
        title="Help"
        subtitle="How to run a mission and read the results"
      />
      <main className="px-4 py-4 lg:px-6">
        <HelpContent />
      </main>
    </>
  )
}