'use client'

import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

type Mission = { id: string; locationName: string | null; startTime: string; endTime: string | null; status: string }

const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const fmtMonth = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

function fmtLength(m: Mission) {
  if (!m.endTime) return 'Live'
  const sec = Math.round((new Date(m.endTime).getTime() - new Date(m.startTime).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${Math.floor(sec / 3600)}h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}m`
}

const nameOf = (m: Mission) => m.locationName || 'Untitled mission'
const labelOf = (m: Mission) =>
  `${nameOf(m)} · ${fmtShort(m.startTime)}, ${fmtClock(m.startTime)}${m.endTime ? `–${fmtClock(m.endTime)}` : ''}`

// Search field that shows the current mission; typing filters every mission (newest first, grouped by month)
export default function MissionPicker({ missions, selected, onSelect }: {
  missions: Mission[]
  selected: Mission
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const q = query.trim().toLowerCase()
  const matches = q
    ? missions.filter(m => `${nameOf(m)} ${fmtShort(m.startTime)} ${fmtMonth(m.startTime)}`.toLowerCase().includes(q))
    : missions

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const close = () => { setOpen(false); setQuery('') }
  const pick = (m: Mission) => { onSelect(m.id); close(); inputRef.current?.blur() }

  return (
    <div className="relative w-full sm:w-[28rem]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Search missions"
        aria-expanded={open}
        aria-controls="mission-list"
        aria-activedescendant={open && matches[active] ? `mission-${matches[active].id}` : undefined}
        value={open ? query : labelOf(selected)}
        placeholder={labelOf(selected)}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0) }}
        onBlur={close}
        onChange={e => { setQuery(e.target.value); setActive(0) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && matches[active]) { e.preventDefault(); pick(matches[active]) }
          else if (e.key === 'Escape') inputRef.current?.blur()
        }}
        className={`h-10 w-full truncate rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 ${open ? 'text-gray-900' : 'font-medium text-gray-900'}`}
      />

      {open && (
        <ul
          ref={listRef}
          id="mission-list"
          role="listbox"
          // Keep focus in the input so clicking an option doesn't blur-close the list first
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
        >
          {matches.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500">No missions match “{query}”</li>}
          {matches.map((m, i) => {
            const month = fmtMonth(m.startTime)
            const newMonth = i === 0 || fmtMonth(matches[i - 1].startTime) !== month
            return (
              <li key={m.id} role="presentation">
                {newMonth && <p className="px-2 pt-2 pb-1 text-xs font-medium text-gray-500">{month}</p>}
                <div
                  id={`mission-${m.id}`}
                  role="option"
                  aria-selected={m.id === selected.id}
                  data-index={i}
                  onClick={() => pick(m)}
                  onMouseMove={() => setActive(i)}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${i === active ? 'bg-gray-100' : ''}`}
                >
                  <span className={`min-w-0 flex-1 truncate ${m.id === selected.id ? 'font-medium text-blue-700' : 'text-gray-900'}`}>{nameOf(m)}</span>
                  <span className="shrink-0 text-xs text-gray-500">{fmtShort(m.startTime)} · {fmtClock(m.startTime)}</span>
                  <span className={`w-12 shrink-0 text-right text-xs ${m.endTime ? 'text-gray-500' : 'font-medium text-green-700'}`}>{fmtLength(m)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
