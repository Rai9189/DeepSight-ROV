'use client'

import { createContext, useContext } from 'react'
import { ChevronDown, LogOut } from 'lucide-react'
import { authHelper } from '@/lib/api-client'
import type { AuthSession } from '@/lib/auth-utils'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type CurrentUser = AuthSession['user']

// Set once in dashboard/layout.tsx so every page's Header can show the account menu
const CurrentUserContext = createContext<CurrentUser | null>(null)

export function CurrentUserProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
}

export default function UserMenu() {
  const user = useContext(CurrentUserContext)
  if (!user) return null
  const initials = user.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex items-center gap-1 rounded-full p-0.5 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 data-[state=open]:text-gray-600"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
          {initials}
        </span>
        <ChevronDown className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium text-gray-900">{user.fullName}</p>
          <p className="truncate text-xs text-gray-500">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => authHelper.logout()}>
          <LogOut className="h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
