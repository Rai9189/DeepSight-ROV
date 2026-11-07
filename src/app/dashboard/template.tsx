// A template remounts on every navigation, so the page-enter animation replays per page.
// The sidebar lives in layout.tsx and stays still.
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>
}
