// Cookie (not localStorage) so the server renders the right sidebar width — no flash on refresh.
// Lives outside Sidebar.tsx: a constant imported from a 'use client' file is not a string on the server.
export const SIDEBAR_COOKIE = 'sidebar_collapsed'
