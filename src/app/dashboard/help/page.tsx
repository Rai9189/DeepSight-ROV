import { requireAuth } from '@/lib/auth-utils'
import HelpContent from '@/components/help/HelpContent'

export const metadata = { title: 'Help' }

export default async function HelpPage() {
  await requireAuth()

  // HelpContent renders the header too, so the language switch can sit in it
  return <HelpContent />
}