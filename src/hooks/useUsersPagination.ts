'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '@/lib/api-client'

export interface User {
  id: string
  fullName: string
  email: string
  phoneNumber: string
  role: 'USER' | 'ADMIN'
  mustChangePassword: boolean
  missionCount?: number
  createdAt: string
  updatedAt: string
}

interface PaginationResponse {
  items: User[]
  nextCursor: string | null
  hasMore: boolean
  pagination: { limit: number; total: number }
}

type SortOrder = 'asc' | 'desc'

const PAGE_SIZE = 20
const SEARCH_DELAY_MS = 300

export function useUsersPagination() {
  const [role, setRole] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<SortOrder>('desc')
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the newest request may update the list — a slow reply for "ad" must not overwrite "admin"
  const requestId = useRef(0)

  // Wait for a pause in typing before searching
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(id)
  }, [search])

  const fetchUsers = useCallback(async (cursor: string | null) => {
    const id = ++requestId.current
    setIsLoading(true)
    setError(null)
    const q = new URLSearchParams({ limit: String(PAGE_SIZE), sort })
    if (cursor) q.set('cursor', cursor)
    if (role) q.set('role', role)
    if (debouncedSearch) q.set('search', debouncedSearch)
    try {
      const data = await apiClient.get<PaginationResponse>(`/api/users?${q}`)
      if (id !== requestId.current) return
      setUsers(prev => (cursor ? [...prev, ...data.items] : data.items))
      setTotal(data.pagination.total)
      setNextCursor(data.nextCursor)
      setHasMore(data.hasMore)
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : "Couldn't load users")
    } finally {
      if (id === requestId.current) setIsLoading(false)
    }
  }, [role, debouncedSearch, sort])

  const reload = useCallback(() => fetchUsers(null), [fetchUsers])
  useEffect(() => { reload() }, [reload])

  const loadMore = useCallback(() => {
    if (nextCursor && hasMore && !isLoading) fetchUsers(nextCursor)
  }, [nextCursor, hasMore, isLoading, fetchUsers])

  const removeFromList = useCallback((id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id))
    setTotal(t => Math.max(0, t - 1))
  }, [])

  return {
    users, total, isLoading, error, hasMore,
    role, setRole, search, setSearch, sort, setSort,
    loadMore, reload, removeFromList,
  }
}
