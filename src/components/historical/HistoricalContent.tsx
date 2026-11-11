'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  BarChart, Bar, LineChart, Line, ReferenceArea, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { ChevronRight, Download, History } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { downloadXlsx } from '@/lib/xlsx-export'
import { getSpeciesColor } from '@/lib/species'
import { TONE, WATER_RANGES, getPhStatus, getDoStatus, getTempStatus, type WaterStatus } from '@/lib/water-quality'

const fetcher = apiClient.swrFetcher

type Mission = {
  id: string
  locationName: string | null
  startTime: string
  endTime: string | null
  status: string
  avgPh: number | null
  avgTds: number | null
  avgTemp: number | null
  avgDo: number | null
  fish: Array<{ species: string; count: number }>
  totalFish: number
}

type Preset = '7' | '30' | '90' | 'all' | 'custom'
const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
]

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm'

// YYYY-MM-DD in local time (toISOString() is UTC and slips a day before 07:00 WIB)
const localDay = (d: Date) => d.toLocaleDateString('sv-SE')
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d) }

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const nameOf = (m: Mission) => m.locationName || 'Untitled mission'

function fmtLength(m: Mission) {
  if (!m.endTime) return 'Live'
  const sec = Math.round((new Date(m.endTime).getTime() - new Date(m.startTime).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
}

const mean = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

// --- Excel: same columns as the previous per-mission export, one row per mission ---
function fmtDateIso(t: string) {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtTimeRangeId(m: Mission) {
  const opts = { hour: '2-digit', minute: '2-digit' } as const
  const start = new Date(m.startTime).toLocaleTimeString('id-ID', opts)
  return m.endTime ? `${start}-${new Date(m.endTime).toLocaleTimeString('id-ID', opts)}` : start
}
function fmtDurationId(m: Mission) {
  if (!m.endTime) return 'Berlangsung...'
  const diff = new Date(m.endTime).getTime() - new Date(m.startTime).getTime()
  return `${Math.floor(diff / 3600000)}j ${String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0')}m`
}

function Stat({ label, value, unit, hint }: { label: string; value: string | number; unit?: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight text-gray-900">{value}</span>
        {unit && value !== '—' && <span className="text-sm text-gray-500">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function Reading({ value, digits, status }: { value: number | null; digits: number; status?: (v: number) => WaterStatus }) {
  if (value == null) return <span className="text-gray-300">—</span>
  const tone = status?.(value).tone
  return <span className={tone && tone !== 'ok' ? `font-medium ${TONE[tone].text}` : 'text-gray-700'}>{value.toFixed(digits)}</span>
}

// One dot per mission (its average); the shaded band is the normal range
function TrendChart({ title, unit, data, dataKey, band, digits = 1 }: {
  title: string; unit: string; data: any[]; dataKey: string; band?: { y1?: number; y2?: number }; digits?: number
}) {
  // Only missions that measured this sensor, so the line joins real readings in mission order
  const points = data.filter(d => d[dataKey] != null)
  const top = Math.max(...points.map(d => d[dataKey] as number))
  return (
    <div className={`${card} p-5`}>
      <h3 className="text-sm font-semibold text-gray-900">{title} <span className="font-normal text-gray-500">· {unit}</span></h3>
      {points.length > 0 ? (
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#f3f4f6" />
              {band && <ReferenceArea y1={band.y1} y2={band.y2 ?? Math.max(top, band.y1 ?? top)} fill="#22c55e" fillOpacity={0.06} ifOverflow="extendDomain" />}
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} minTickGap={16} tickMargin={8} padding={{ left: 16, right: 16 }} />
              <YAxis domain={['auto', 'auto']} allowDecimals={digits > 0} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} tickMargin={8} tickFormatter={v => Number(v).toFixed(digits)} />
              <Tooltip
                labelFormatter={(_, p) => (p?.[0] ? `${p[0].payload.name} · ${p[0].payload.label}` : '')}
                formatter={v => [`${Number(v).toFixed(digits)} ${unit}`, title]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Line type="linear" dataKey={dataKey} stroke="#2563eb" strokeWidth={1.5} dot={{ r: 3, fill: '#2563eb' }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="flex h-40 items-center justify-center text-sm text-gray-500">No sensor data in this range</p>
      )}
    </div>
  )
}

const th = 'px-2 sm:px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap'
const td = 'px-2 sm:px-3 py-2.5 text-center whitespace-nowrap'

export default function HistoricalContent() {
  const router = useRouter()
  const [preset, setPreset] = useState<Preset>('30')
  const [customFrom, setCustomFrom] = useState(() => daysAgo(30))
  const [customTo, setCustomTo] = useState(() => localDay(new Date()))

  const { data: sessionsData, error: sessionsError, isLoading } = useSWR('/api/analytics/sessions', fetcher, { refreshInterval: 60000 })
  // fish/totalFish default to empty so an older backend without them can't crash the page
  const allMissions: Mission[] = ((sessionsData as any)?.data || []).map((m: Mission) => ({ ...m, fish: m.fish ?? [], totalFish: m.totalFish ?? 0 }))

  // Range in local days; null = all time
  const reversed = preset === 'custom' && customFrom > customTo
  const range = preset === 'all' || reversed ? null
    : preset === 'custom' ? { from: customFrom, to: customTo }
    : { from: daysAgo(Number(preset)), to: localDay(new Date()) }

  const missions = allMissions.filter(m => {
    if (!range) return true
    const day = localDay(new Date(m.startTime))
    return day >= range.from && day <= range.to
  })

  // Charts read oldest → newest; the table lists newest first (API order)
  const chronological = [...missions].reverse()
  const speciesTotals = new Map<string, number>()
  missions.forEach(m => m.fish.forEach(f => speciesTotals.set(f.species, (speciesTotals.get(f.species) ?? 0) + f.count)))
  const species = [...speciesTotals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)

  const chartData = chronological.map(m => ({
    name: nameOf(m),
    // Date + start time: several missions on one day would otherwise share the same label
    label: `${fmtShort(m.startTime)} · ${new Date(m.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
    ph: m.avgPh, do: m.avgDo, temp: m.avgTemp, tds: m.avgTds,
    ...Object.fromEntries(m.fish.map(f => [f.species, f.count])),
  }))

  const totalFish = missions.reduce((s, m) => s + m.totalFish, 0)
  const avgPh = mean(missions.map(m => m.avgPh))
  const avgDo = mean(missions.map(m => m.avgDo))
  const rangeText = range ? `${fmtDate(`${range.from}T00:00`)} – ${fmtDate(`${range.to}T00:00`)}` : 'All missions'

  const downloadExcel = () =>
    downloadXlsx(
      `trends-missions-${range ? `${range.from}_${range.to}` : 'all'}.xlsx`,
      ['TANGGAL', 'NAMA MISI', 'WAKTU MISI', 'SESSION ID', 'DURASI', 'JML IKAN', 'SPESIES', 'PH', 'TDS', 'SUHU', 'DO'],
      missions.map(m => [
        fmtDateIso(m.startTime), nameOf(m), fmtTimeRangeId(m), `session_${m.id.slice(-3)}`, fmtDurationId(m),
        m.totalFish, m.fish.length, m.avgPh, m.avgTds, m.avgTemp, m.avgDo,
      ])
    ).catch(() => toast.error("Couldn't download the mission list"))

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
      </div>
    )
  }

  // A failed request must not read as "no missions" — the data may well be there
  const failed = !!sessionsError && !sessionsData

  const inputCls = 'h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100'

  return (
    <div className="space-y-4">
      {/* Range */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Date range">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              aria-pressed={preset === p.key}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 ${preset === p.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="From" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value || localDay(new Date()))} className={inputCls} />
            <span className="text-sm text-gray-500">–</span>
            <input type="date" aria-label="To" value={customTo} min={customFrom} onChange={e => setCustomTo(e.target.value || localDay(new Date()))} className={inputCls} />
            {reversed && <span className="text-sm text-red-600">“From” must be on or before “To”</span>}
          </div>
        )}
      </div>

      {missions.length === 0 ? (
        <div className={`${card} flex flex-col items-center justify-center p-12 text-center`}>
          <History className="mb-3 h-7 w-7 text-gray-300" />
          <p className="text-base font-semibold text-gray-700">
            {failed ? "Couldn't load missions" : allMissions.length ? 'No missions in this range' : 'No missions yet'}
          </p>
          {failed ? (
            <p className="mt-1 text-sm text-gray-500">Check the connection to the server. The page retries automatically.</p>
          ) : allMissions.length > 0 ? (
            <button onClick={() => setPreset('all')} className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700">Show all missions</button>
          ) : (
            <p className="mt-1 text-sm text-gray-500">Trends appear once missions are recorded.</p>
          )}
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className={`${card} px-5 py-4`}>
            <p className="text-sm font-medium text-gray-700">{rangeText}</p>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Missions" value={missions.length} />
              <Stat label="Fish counted" value={totalFish.toLocaleString('en-US')} hint="Most seen at once, per species" />
              <Stat label="Species" value={species.length} />
              <Stat label="Avg pH" value={avgPh != null ? avgPh.toFixed(1) : '—'} />
              <Stat label="Avg dissolved oxygen" value={avgDo != null ? avgDo.toFixed(1) : '—'} unit="mg/L" />
            </div>
          </div>

          {/* Fish per mission */}
          <div className={`${card} p-5`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Fish counted per mission</h2>
                <p className="text-xs text-gray-500">One bar per mission, oldest on the left</p>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {species.map((sp, i) => (
                  <span key={sp} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getSpeciesColor(sp) }} />{sp}
                  </span>
                ))}
              </div>
            </div>
            {totalFish > 0 ? (
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} minTickGap={8} tickMargin={8} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} tickMargin={8} />
                    <Tooltip
                      cursor={{ fill: '#f3f4f6' }}
                      labelFormatter={(_, p) => (p?.[0] ? `${p[0].payload.name} · ${p[0].payload.label}` : '')}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    {species.map((sp, i) => (
                      <Bar key={sp} dataKey={sp} stackId="fish" fill={getSpeciesColor(sp)} maxBarSize={40} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="flex h-40 items-center justify-center text-sm text-gray-500">No fish counted in this range</p>
            )}
          </div>

          {/* Water quality per mission */}
          <div>
            <h2 className="mb-2 text-base font-semibold text-gray-900">
              Water quality <span className="text-sm font-normal text-gray-500">· mission averages, normal range shaded</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <TrendChart title="pH" unit="pH" data={chartData} dataKey="ph" band={{ y1: WATER_RANGES.ph.min, y2: WATER_RANGES.ph.max }} />
              <TrendChart title="Dissolved oxygen" unit="mg/L" data={chartData} dataKey="do" band={{ y1: WATER_RANGES.do.min }} />
              <TrendChart title="Water temperature" unit="°C" data={chartData} dataKey="temp" band={{ y1: WATER_RANGES.temp.min, y2: WATER_RANGES.temp.max }} />
              {/* No band for TDS until the team sets seawater thresholds */}
              <TrendChart title="TDS" unit="ppm" data={chartData} dataKey="tds" digits={0} />
            </div>
          </div>

          {/* Mission list */}
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-semibold text-gray-900">Missions</h2>
                <span className="text-xs text-gray-500">{missions.length}</span>
              </div>
              <button
                onClick={downloadExcel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
              >
                <Download className="h-3.5 w-3.5" /> Excel
              </button>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm sm:table-fixed">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className={`${th} w-20`}>Date</th>
                    <th className={`${th} w-60`}>Mission</th>
                    <th className={th}>Duration</th>
                    <th className={th}>Fish</th>
                    <th className={th}>Species</th>
                    <th className={th}>pH</th>
                    <th className={th}>DO mg/L</th>
                    <th className={th}>Temp °C</th>
                    <th className={th}>TDS ppm</th>
                    <th className={`${th} w-10`}><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {missions.map(m => {
                    const href = `/dashboard/analytics?session=${m.id}`
                    return (
                      <tr key={m.id} onClick={() => router.push(href)} className="cursor-pointer hover:bg-gray-50">
                        <td className={`${td} text-gray-500`}>{fmtShort(m.startTime)}</td>
                        <td className={`${td} max-w-[15rem] truncate`}>
                          <Link href={href} onClick={e => e.stopPropagation()} className="font-medium text-gray-900 hover:text-blue-700 focus-visible:outline-none focus-visible:underline">
                            {nameOf(m)}
                          </Link>
                        </td>
                        <td className={`${td} ${m.endTime ? 'text-gray-700' : 'font-medium text-green-700'}`}>{fmtLength(m)}</td>
                        <td className={`${td} text-gray-900`}>{m.totalFish}</td>
                        <td className={`${td} text-gray-700`}>{m.fish.length}</td>
                        <td className={td}><Reading value={m.avgPh} digits={1} status={getPhStatus} /></td>
                        <td className={td}><Reading value={m.avgDo} digits={1} status={getDoStatus} /></td>
                        <td className={td}><Reading value={m.avgTemp} digits={1} status={getTempStatus} /></td>
                        <td className={td}><Reading value={m.avgTds} digits={0} /></td>
                        <td className={`${td} text-gray-300`}><ChevronRight className="h-4 w-4" /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">
              Values are mission averages; coloured ones are outside the normal range. Select a mission to open its report.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
