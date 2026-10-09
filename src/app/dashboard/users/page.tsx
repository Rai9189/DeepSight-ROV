import { requireAdmin } from '@/lib/auth-utils'
import Header from '@/components/layout/Header'
import UsersContent from '@/components/users/UsersContent'

export const metadata = { title: 'Users' }

export default async function UsersPage() {
  const session = await requireAdmin()

  return (
    <>
      <Header title="Users" subtitle="Manage who can sign in" />
      <main className="px-4 py-4 lg:px-6">
        <UsersContent currentUserId={session.user.id} />
      </main>
    </>
  )
}
