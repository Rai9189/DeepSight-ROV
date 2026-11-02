// Shown instantly while the next dashboard page loads; the sidebar stays in place
export default function DashboardLoading() {
  return (
    <div role="status" className="flex h-[60vh] flex-col items-center justify-center gap-3 text-sm text-gray-500">
      <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-blue-500 motion-safe:animate-spin" />
      Loading…
    </div>
  )
}
