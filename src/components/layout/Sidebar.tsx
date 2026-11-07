'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Anchor, Radio, Users, Video, Menu, X, Home, ChevronLeft, BarChart3, HelpCircle, History, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AuthSession } from '@/lib/auth-utils'
import { SIDEBAR_COOKIE } from '@/lib/sidebar'

interface SidebarProps {
  session: AuthSession
  defaultCollapsed: boolean
}

type NavItem = { label: string; href: string; icon: LucideIcon }

const MAIN_ITEMS: NavItem[] = [
  { label: 'Dashboard',      href: '/dashboard',            icon: Home },
  { label: 'Live Stream',    href: '/dashboard/stream',     icon: Radio },
  { label: 'Recordings',     href: '/dashboard/recordings', icon: Video },
  { label: 'Mission Report', href: '/dashboard/analytics',  icon: BarChart3 },
  { label: 'Trends',         href: '/dashboard/historical', icon: History },
  { label: 'Help',           href: '/dashboard/help',       icon: HelpCircle },
]
const ADMIN_ITEMS: NavItem[] = [{ label: 'Users', href: '/dashboard/users', icon: Users }]


const Sidebar = ({ session, defaultCollapsed }: SidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const pathname = usePathname()
  const { role } = session.user

  useEffect(() => {
    document.cookie = `${SIDEBAR_COOKIE}=${isCollapsed ? 1 : 0}; path=/; max-age=31536000; samesite=lax`
  }, [isCollapsed])

  // Ctrl+B (Cmd+B on Mac) toggles the sidebar, except while typing in a field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return
      const el = e.target as HTMLElement | null
      if (el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '')) return
      e.preventDefault()
      setIsCollapsed(c => !c)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href)

  const NavLinks = ({ items }: { items: NavItem[] }) => (
    <div className="space-y-0.5 px-2">
      {items.map(({ label, href, icon: Icon }) => {
        const active = isActive(href)
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setIsMobileOpen(false)}
            aria-current={active ? 'page' : undefined}
            title={isCollapsed ? label : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 ${
              active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            } ${isCollapsed ? 'justify-center' : ''}`}
          >
            <Icon className={`h-5 w-5 flex-shrink-0 ${active ? 'text-blue-600' : 'text-gray-400'}`} />
            {!isCollapsed && <span className="truncate">{label}</span>}
          </Link>
        )
      })}
    </div>
  )

  return (
    <>
      {/* Always rendered so it can fade in step with the sliding sidebar */}
      <div aria-hidden className={`fixed inset-0 bg-black/20 z-40 lg:hidden transition-opacity duration-200 ease-out ${
        isMobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`} onClick={() => setIsMobileOpen(false)} />

      {/* Mobile toggle button */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Button variant="outline" size="icon" onClick={() => setIsMobileOpen(true)} className="bg-white" aria-label="Open menu">
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      <aside data-collapsed={isCollapsed} className={`fixed top-0 left-0 h-full bg-white border-r border-gray-200 transition-[width,transform] duration-200 ease-out z-50 flex flex-col ${
        isCollapsed ? 'w-16' : 'w-64'
      } ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>

        {/* Brand */}
        <div className={`flex h-16 flex-shrink-0 items-center border-b border-gray-200 ${isCollapsed ? 'justify-center px-2' : 'gap-3 px-4'}`}>
          {isCollapsed ? (
            <button type="button" onClick={() => setIsCollapsed(false)} aria-label="Expand sidebar"
              title="Expand sidebar (Ctrl+B)" aria-keyshortcuts="Control+B"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
              <Anchor className="h-5 w-5 text-white" />
            </button>
          ) : (
            <>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-600">
                <Anchor className="h-5 w-5 text-white" />
              </div>
              <span className="flex-1 truncate text-base font-semibold tracking-tight text-gray-900">Carter Island AUV</span>
              <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(true)} aria-label="Collapse sidebar"
                title="Collapse sidebar (Ctrl+B)" aria-keyshortcuts="Control+B" className="hidden lg:flex h-8 w-8 text-gray-400">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setIsMobileOpen(false)} aria-label="Close menu" className="lg:hidden h-8 w-8 text-gray-400">
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <NavLinks items={MAIN_ITEMS} />
          {role === 'ADMIN' && (
            <div className="mt-4">
              {isCollapsed
                ? <div className="mx-4 mb-2 border-t border-gray-100" />
                : <p className="mb-1 px-5 text-xs font-medium text-gray-400">Admin</p>}
              <NavLinks items={ADMIN_ITEMS} />
            </div>
          )}
        </nav>

      </aside>
    </>
  )
}

export default Sidebar
