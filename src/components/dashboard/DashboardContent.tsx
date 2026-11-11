'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Anchor, ChevronRight } from 'lucide-react'
import { apiClient, isApiStatus } from '@/lib/api-client'
import { getSpeciesColor } from '@/lib/species'
import { getPhStatus, getDoStatus, getTempStatus, getTdsStatus } from '@/lib/water-quality'
import SensorCard from '@/components/dashboard/SensorCard'

const fetcher = apiClient.swrFetcher

// Data older than this is shown as stale (ROV may be disconnected)
const STALE_SECONDS = 30

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

function fmtDuration(ms: number) {
  if (ms <= 0) return '—'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`
}

function fmtAgo(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-gray-900">{value}</p>
    </div>
  )
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-80 text-center">
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <Anchor className="w-7 h-7 text-gray-500" />
      </div>
      <h3 className="text-base font-semibold text-gray-700 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 max-w-xs">{text}</p>
    </div>
  )
}

// Hover marker on the dive profile: a small ROV (yellow float on top, blue frame, side thrusters, camera)
function RovMarker({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return <g />
  return (
    <g transform={`translate(${cx - 14}, ${cy - 10})`} pointerEvents="none">
      <rect x="7" y="1" width="14" height="5" rx="2" fill="#facc15" stroke="#fff" strokeWidth="1.5" />
      <rect x="4" y="5" width="20" height="11" rx="3" fill="#2563eb" stroke="#fff" strokeWidth="1.5" />
      <rect x="0" y="8" width="5" height="6" rx="1.5" fill="#1e3a8a" stroke="#fff" strokeWidth="1" />
      <rect x="23" y="8" width="5" height="6" rx="1.5" fill="#1e3a8a" stroke="#fff" strokeWidth="1" />
      <circle cx="14" cy="11" r="2.5" fill="#fff" />
    </g>
  )
}

const deg = (v: number | null | undefined, digits = 1) => (v != null ? `${v.toFixed(digits)}°` : '—')

// heading is stored as text: compass letters from seed data ("NE") or degrees from the ROV ("182.5")
const fmtHeading = (h: string | number | null | undefined) =>
  h == null || h === '' ? '—' : Number.isFinite(Number(h)) ? deg(Number(h), 0) : String(h)

export default function DashboardContent() {
  // Ticks every second so "Updated Xs ago" and the live duration stay current
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Running mission first (live), otherwise the last completed one
  const { data: activeSessionData, error: activeSessionError } = useSWR(
    '/api/sessions/active',
    fetcher,
    { refreshInterval: 5000, shouldRetryOnError: false, errorRetryCount: 0, revalidateOnFocus: false }
  )
  const hasRunning = !!(activeSessionData as any)?.data
  // Last mission regardless of status — auto-aborted missions are real missions too
  const { data: completedSessionData, error: completedSessionError, isLoading: sessionLoading } = useSWR(
    hasRunning ? null : '/api/sessions?limit=1&sort=desc',
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: false }
  )

  const session = hasRunning
    ? (activeSessionData as any)?.data
    : (() => {
        const raw = (completedSessionData as any)?.data
        return Array.isArray(raw) ? raw[0] : raw
      })()

  // Telemetry & AUV must come from the same mission as the header strip, not the latest global row
  const { data: telemetryData } = useSWR(
    session?.id ? `/api/telemetry/latest?session_id=${session.id}` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  const { data: auvData } = useSWR(
    session?.id ? `/api/auv-status/latest?session_id=${session.id}` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  const { data: fishData } = useSWR(
    session?.id ? `/api/fish-counts/session/${session.id}` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  // The finished mission's video (a recording is saved when the stream stops)
  const { data: recordingData } = useSWR(
    session?.id && !hasRunning ? `/api/recordings?session_id=${session.id}&limit=1` : null,
    fetcher,
    { revalidateOnFocus: false }
  )
  // Whole-mission averages + depth series. The endpoint defaults to the last 24h, so widen the window.
  const { data: summaryData } = useSWR(
    session?.id ? `/api/analytics/telemetry?session_id=${session.id}&hours=876000` : null,
    fetcher,
    { refreshInterval: hasRunning ? 10000 : 0, revalidateOnFocus: false }
  )
  const telemetry = (telemetryData as any)?.data
  const recording = (recordingData as any)?.data?.[0]
  const summary = (summaryData as any)?.data?.summary
  const depthSeries: Array<{ time: string; value: number }> = (summaryData as any)?.data?.depth ?? []
  const auv = (auvData as any)?.data
  const fishRaw = (fishData as any)?.data

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  // 404 on /sessions/active just means no mission is running
  const sessionFetchFailed = [activeSessionError, completedSessionError]
    .some(err => err && !isApiStatus(err, 404))
  if (!session && sessionFetchFailed) {
    return <EmptyState title="Couldn't load data" text="Check the connection to the server. The page retries automatically." />
  }
  if (!session) {
    return <EmptyState title="No missions yet" text="The dashboard shows data once the first mission starts." />
  }

  const isLive = session.status === 'Running'
  const startMs = session.startTime ? new Date(session.startTime).getTime() : null
  const endMs = session.endTime ? new Date(session.endTime).getTime() : null
  const duration = startMs ? fmtDuration((isLive ? now : endMs ?? now) - startMs) : '—'

  const lastDataMs = Math.max(
    telemetry?.timestamp ? new Date(telemetry.timestamp).getTime() : 0,
    auv?.timestamp ? new Date(auv.timestamp).getTime() : 0,
  )
  const agoSec = lastDataMs ? (now - lastDataMs) / 1000 : null

  const hasTelemetry = (summary?.dataPoints ?? 0) > 0 || !!telemetry
  const hasSensorData = hasTelemetry || !!auv
  // Live: current reading. Finished: average over the whole mission.
  const water = isLive
    ? { ph: telemetry?.phLevel, tds: telemetry?.tdsValue, do: telemetry?.dissolvedOxygen, temp: telemetry?.waterTemp }
    : hasTelemetry
      ? { ph: summary?.avgPh, tds: summary?.avgTds, do: summary?.avgDo, temp: summary?.avgTemp }
      : { ph: null, tds: null, do: null, temp: null }
  const avg = isLive ? '' : 'Avg '
  const depths = depthSeries.map(d => d.value)
  // ponytail: series points are bucket averages for long missions, so max depth is slightly under the true peak
  const maxDepth = depths.length ? Math.max(...depths) : null
  const avgDepth = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : null
  const chartData = depthSeries.map(d => ({ t: new Date(d.time).getTime(), depth: d.value }))

  const speciesCounts: Array<{ speciesName: string; totalCount: number }> = Array.isArray(fishRaw?.counts) ? fishRaw.counts : []
  const speciesTotal: number = fishRaw?.totalFish ?? 0
  const speciesChartData = speciesCounts.map(c => ({ name: c.speciesName, value: c.totalCount }))

  const sensorHealth = [
    { label: 'Gyroscope', ok: !!auv?.gyroscope },
    { label: 'Accelerometer', ok: !!auv?.accelerometer },
    { label: 'Magnetometer', ok: !!auv?.magnetometer },
  ]

  return (
    <div className="space-y-4">

      {/* Mission strip */}
      <div className={`${card} px-5 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold tracking-tight text-gray-900">{session.locationName || 'Untitled mission'}</h2>
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 motion-safe:animate-pulse" /> LIVE
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{session.status}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {startMs ? `Started ${fmtDateTime(session.startTime)}` : 'Start time unknown'}
            {!isLive && endMs ? ` · Ended ${fmtDateTime(session.endTime)}` : ''}
            {' · '}{duration}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-4 text-sm">
          {isLive && (
            <span className={agoSec != null && agoSec <= STALE_SECONDS ? 'text-gray-500' : 'text-amber-700'}>
              {agoSec != null ? `Updated ${fmtAgo(agoSec)}` : 'Waiting for data'}
            </span>
          )}
          {recording && (
            <Link href={`/dashboard/recordings?play=${recording.id}`} className="inline-flex items-center gap-0.5 font-medium text-blue-600 hover:text-blue-700">
              Watch recording <ChevronRight className="h-4 w-4" />
            </Link>
          )}
          <Link href={`/dashboard/analytics?session=${session.id}`} className="inline-flex items-center gap-0.5 font-medium text-blue-600 hover:text-blue-700">
            View report <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Water quality + dive profile, or a clear notice when the mission recorded none */}
      {!hasSensorData && !isLive ? null : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SensorCard label={`${avg}pH`} value={water.ph} unit="pH" status={getPhStatus} />
          <SensorCard label={`${avg}TDS`} value={water.tds} unit="ppm" status={getTdsStatus} />
          <SensorCard label={`${avg}dissolved oxygen`} value={water.do} unit="mg/L" status={getDoStatus} />
          <SensorCard label={`${avg}water temperature`} value={water.temp} unit="°C" status={getTempStatus} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {!hasSensorData && !isLive ? (
          <div className={`lg:col-span-2 ${card} flex flex-col items-center justify-center p-10 text-center`}>
            <p className="text-base font-semibold text-gray-700">No sensor data recorded for this mission</p>
            <p className="mt-1 max-w-sm text-sm text-gray-500">Water quality and ROV readings were not received while it ran. Fish detections are still shown.</p>
          </div>
        ) : (
          <div className={`lg:col-span-2 ${card} p-5 flex flex-col`}>
            <h2 className="text-base font-semibold text-gray-900">Dive profile</h2>
            {maxDepth != null && (
              <p className="text-xs text-gray-500">Max {maxDepth.toFixed(1)} m · Avg {avgDepth!.toFixed(1)} m</p>
            )}
            {chartData.length > 1 ? (
              <div className="mt-3 min-h-48 flex-1">{/* grows to match the Species card */}
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} tickMargin={8} padding={{ left: 16, right: 8 }} minTickGap={24}
                      tickFormatter={(t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} />
                    {/* Reversed so deeper is lower, like a real dive */}
                    {/* Whole metres from the surface: fractional ticks ("0.85 m") were clipped at the left edge */}
                    <YAxis reversed domain={[0, (max: number) => Math.max(1, Math.ceil(max))]} allowDecimals={false}
                      tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} unit=" m" width={56} tickMargin={8} />
                    <Tooltip labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString('en-GB')} formatter={(v) => [`${Number(v).toFixed(2)} m`, 'Depth']}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', fontSize: '12px' }} />
                    <Area type="monotone" dataKey="depth" stroke="#2563eb" strokeWidth={2} fill="#dbeafe" isAnimationActive={false}
                      activeDot={(p: { cx?: number; cy?: number; index?: number }) => <RovMarker key={p.index} cx={p.cx} cy={p.cy} />} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="mt-3 flex min-h-48 flex-1 items-center justify-center text-sm text-gray-500">
                {isLive ? 'Waiting for depth readings…' : 'Not enough depth readings to draw a profile'}
              </div>
            )}

            {isLive && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-3">
                  <Stat label="Depth" value={auv?.depth != null ? `${auv.depth.toFixed(1)} m` : '—'} />
                  <Stat label="Heading" value={fmtHeading(auv?.heading)} />
                  <Stat label="Speed" value={auv?.speed != null ? `${auv.speed.toFixed(1)} kts` : '—'} />
                  <Stat label="Roll" value={deg(auv?.roll)} />
                  <Stat label="Pitch" value={deg(auv?.pitch)} />
                  <Stat label="Yaw" value={deg(auv?.yaw, 0)} />
                </div>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                  {sensorHealth.map(({ label, ok }) => (
                    <span key={label} className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-green-500' : 'border border-gray-300'}`} />
                      {label}
                      <span className={`text-xs font-medium ${ok ? 'text-green-700' : 'text-gray-500'}`}>{ok ? 'OK' : 'N/A'}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Species */}
        <div className={`${card} p-5`}>
          <h2 className="text-base font-semibold text-gray-900">Fish counted</h2>
          <p className="text-xs text-gray-500">Most seen at once, per species</p>
          {speciesChartData.length > 0 ? (
            <div className="flex flex-col items-center">
              <div className="relative w-full h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={speciesChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
                      {speciesChartData.map((entry, index) => (
                        <Cell key={entry.name} fill={getSpeciesColor(entry.name)} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-3xl font-semibold tracking-tight text-gray-900">{speciesTotal}</span>
                  <span className="text-xs text-gray-500">fish</span>
                </div>
              </div>
              <div className="w-full space-y-1.5 mt-2">
                {speciesChartData.map((entry, index) => (
                  <div key={entry.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getSpeciesColor(entry.name) }} />
                      <span className="text-gray-600">{entry.name}</span>
                    </div>
                    <span className="font-medium text-gray-900">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-52 items-center justify-center">
              <p className="text-sm text-gray-500">No fish detected in this mission yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
