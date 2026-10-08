// src/components/layout/Header.tsx
import { ReactNode } from 'react'
import UserMenu from './UserMenu'

interface HeaderProps {
  title: string
  subtitle?: string
  children?: ReactNode
}

const Header = ({ title, subtitle, children }: HeaderProps) => {
  return (
    <header className="flex h-16 items-center bg-white border-b border-gray-200 px-6 lg:px-8">
      <div className="flex w-full items-center justify-between gap-4">
        {/* ml-14: room for the fixed mobile menu button */}
        <div className="ml-14 min-w-0 lg:ml-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900">{title}</h1>
          {subtitle && <p className="truncate text-sm text-gray-500">{subtitle}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-4">
          {children}
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

export default Header
