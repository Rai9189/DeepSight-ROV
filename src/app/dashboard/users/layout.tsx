// The Users page is a client component, which can't export metadata, so its tab title lives here
export const metadata = { title: 'Users' }

export default function UsersLayout({ children }: { children: React.ReactNode }) {
  return children
}
