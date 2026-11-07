'use client'

import useSWR from 'swr'
import { apiClient } from '@/lib/api-client'

// The backend re-checks the ROV every 5 seconds
export default function RovStatus() {
  const { data, error } = useSWR<{ rov_online?: boolean }>('/api/health', apiClient.swrFetcher, { refreshInterval: 5000 })
  // No backend means the ROV's state is unknown, which is not the same as offline
  if (error || !data) return null

  const online = data.rov_online === true
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-gray-500">
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-gray-400'}`} aria-hidden="true" />
      {online ? 'ROV online' : 'ROV offline'}
    </span>
  )
}
