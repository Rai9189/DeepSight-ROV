'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { toast } from 'sonner'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import Link from 'next/link'
import { BarChart3, Download, Play } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { downloadXlsx } from '@/lib/xlsx-export'
import { getSpeciesColor } from '@/lib/species'
import { TONE, WATER_RANGES, getPhStatus, getDoStatus, getTempStatus, type WaterStatus } from '@/lib/water-quality'
import SensorCard from '@/components/dashboard/SensorCard'
import { Skeleton } from '@/components/ui/skeleton'
import MissionPicker from '@/components/analytics/MissionPicker'

const fetcher = apiClient.swrFetcher

// Analytics endpoints default to the last 24h; a mission can be older, so widen the window (same as Dashboard)
const ALL_TIME = 'hours=876000'
const LOG_ROWS = 20
const MINUTE = 60_000

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmtClock = (iso: string | number, seconds = false) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(seconds && { second: '2-digit' }) })

function fmtDuration(ms: number) {
  if (ms <= 0) return '—'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`
}

// --- Excel export: columns unchanged from the previous version ---
function fmtDateIso(t: string) {
  const d = new Date(t)
  if (isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDurationId(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}j ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}d`
}
function fmtTimeRangeId(startTime: string, endTime: string | null) {
  const opts = { hour: '2-digit', minute: '2-digit' } as const
  const start = new Date(startTime).toLocaleTimeString('id-ID', opts)
  return endTime ? `${start}-${new Date(endTime).toLocaleTimeString('id-ID', opts)}` : start
}
const fmtClockId = (t: string) =>
  new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// The on-screen logs only hold the latest rows — fetch the whole session for export
async function fetchAllRows(endpoint: string, total: number): Promise<any[]> {
  const res = await apiClient.get<any>(`${endpoint}&limit=${Math.max(total, 1)}`)
  return res?.data || []
}

// Minutes without detections are missing from the API; fill them with 0 so the line doesn't bridge gaps
function fillMinutes(series: Array<{ time: string; detections: number }>, startMs: number, endMs: number) {
  const counts = new Map(series.map(p => [new Date(p.time).getTime(), p.detections]))
  const first = Math.floor(startMs / MINUTE) * MINUTE
  const points: Array<{ t: number; detections: number }> = []
  for (let t = first; t <= endMs; t += MINUTE) points.push({ t, detections: counts.get(t) ?? 0 })
  return points
}

// Same scale as the Trends summary: both report pages open with their key figures
function Stat({ label, value, unit, hint }: { label: string; value: string | number; unit?: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight text-gray-900">{value}</span>
        {unit && value !== '—' && <span className="text-sm text-gray-500">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

// Out-of-range readings get the status colour; normal ones stay plain
function Reading({ value, digits, status }: { value: number | null | undefined; digits: number; status?: (v: number) => WaterStatus }) {
  if (value == null) return <span className="text-gray-300">—</span>
  const tone = status?.(value).tone
  return <span className={tone && tone !== 'ok' ? `font-medium ${TONE[tone].text}` : 'text-gray-700'}>{value.toFixed(digits)}</span>
}

function LogCard({ title, shown, total, onDownload, footer, children }: {
  title: string; shown: number; total: number; onDownload: () => void; footer?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className={`${card} flex flex-col overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <span className="text-xs text-gray-500">{total > shown ? `Latest ${shown} of ${total.toLocaleString('en-US')}` : `${total} rows`}</span>
        </div>
        <button
          onClick={onDownload}
          disabled={total === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
        >
          <Download className="h-3.5 w-3.5" /> Excel
        </button>
      </div>
      {/* ~10 rows visible; the header row stays pinned while scrolling */}
      <div className="max-h-[27rem] flex-1 overflow-auto">{children}</div>
      {footer}
    </div>
  )
}

const th = 'px-2 sm:px-4 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap'
const td = 'px-2 sm:px-4 py-2.5 text-center whitespace-nowrap'

export default function AnalyticsContent() {
  // Selected mission lives in the URL (?session=…) so refresh, back and shared links keep it
  const router = useRouter()
  const selectedId = useSearchParams().get('session')

  const { data: sessionsData, error: sessionsError, isLoading: sessionsLoading } = useSWR('/api/analytics/sessions', fetcher, { refreshInterval: 30000 })
  const allSessions: any[] = (sessionsData as any)?.data || []
  const session = allSessions.find(s => s.id === selectedId) ?? allSessions[0]
  const sessionId: string = session?.id ?? ''

  const q = `session_id=${sessionId}`
  const { data: detectionData } = useSWR(sessionId ? `/api/analytics/detections?${q}&${ALL_TIME}&bucket=minute` : null, fetcher, { refreshInterval: 30000 })
  const { data: telemetryData } = useSWR(sessionId ? `/api/analytics/telemetry?${q}&${ALL_TIME}` : null, fetcher, { refreshInterval: 30000 })
  const { data: detectionListData } = useSWR(sessionId ? `/api/detections?${q}&limit=${LOG_ROWS}` : null, fetcher, { refreshInterval: 30000 })
  const { data: telemetryListData } = useSWR(sessionId ? `/api/telemetry?${q}&limit=${LOG_ROWS}` : null, fetcher, { refreshInterval: 30000 })
  const { data: recordingData } = useSWR(sessionId ? `/api/recordings?${q}&limit=1` : null, fetcher)

  const detections = (detectionData as any)?.data
  const telemetry = (telemetryData as any)?.data
  const detectionList: any[] = (detectionListData as any)?.data || []
  const telemetryList: any[] = (telemetryListData as any)?.data || []
  const detectionTotal: number = (detectionListData as any)?.pagination?.total ?? detectionList.length
  const telemetryTotal: number = (telemetryListData as any)?.pagination?.total ?? telemetryList.length
  // ponytail: links the newest recording only; a mission with several recordings shows the rest in Recordings
  const recording = (recordingData as any)?.data?.[0]

  if (sessionsLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) {
    // A failed request must not read as "no missions" — the data may well be there
    const failed = !!sessionsError && !sessionsData
    return (
      <div className={`${card} flex flex-col items-center justify-center p-12 text-center`}>
        <BarChart3 className="mb-3 h-7 w-7 text-gray-300" />
        <p className="text-base font-semibold text-gray-700">{failed ? "Couldn't load missions" : 'No missions yet'}</p>
        <p className="mt-1 text-sm text-gray-500">
          {failed ? 'Check the connection to the server. The page retries automatically.' : 'Reports appear once the first mission is recorded.'}
        </p>
      </div>
    )
  }

  const isLive = session.status === 'Running'
  const startMs = new Date(session.startTime).getTime()
  const endMs = session.endTime ? new Date(session.endTime).getTime() : Date.now()
  const durationSec = Math.floor((endMs - startMs) / 1000)

  const totalDetections: number = detections?.summary?.totalDetections ?? 0
  const avgConfidence: number = detections?.summary?.avgConfidence ?? 0
  const speciesDist: Array<{ species: string; count: number }> = detections?.speciesDistribution || []
  const speciesMax = speciesDist[0]?.count ?? 0
  // ponytail: one point per minute; a mission of many hours makes a dense but still readable line
  const chartData = detections ? fillMinutes(detections.timeSeries || [], startMs, endMs) : []

  const hasTelemetry = (telemetry?.summary?.dataPoints ?? 0) > 0
  const s = telemetry?.summary
  // Min/max only when the API sent them (older backends don't)
  const rangeOf = (k: 'Ph' | 'Tds' | 'Do' | 'Temp') =>
    hasTelemetry && s[`min${k}`] != null && s[`max${k}`] != null ? { min: s[`min${k}`], max: s[`max${k}`] } : undefined
  const depths: number[] = (telemetry?.depth ?? []).map((d: any) => d.value)
  // ponytail: series points are bucket averages for long missions, so max depth is slightly under the true peak
  const maxDepth = depths.length ? Math.max(...depths) : null

  // Excel only — kept identical to the previous export
  const sessionLabel = `session_${sessionId.slice(-3)}`
  const xlsMissionTime = fmtTimeRangeId(session.startTime, session.endTime ?? null)
  const xlsDuration = session.endTime && durationSec > 0 ? fmtDurationId(durationSec) : '—'

  const downloadDetections = async () => {
    try {
      const rows = await fetchAllRows(`/api/detections?${q}`, detectionTotal)
      await downloadXlsx(
        `detection-log-${sessionLabel}.xlsx`,
        ['TANGGAL', 'WAKTU MISI', 'SESSION ID', 'DURASI MISI', 'WAKTU DETEKSI', 'SPESIES', 'CONFIDENCE', 'KEDALAMAN (m)'],
        rows.map((r: any) => [
          fmtDateIso(r.detectedAt), xlsMissionTime, sessionLabel, xlsDuration, fmtClockId(r.detectedAt),
          r.speciesName, { value: r.confidence, format: '0%' }, r.depthAtDetection ?? null,
        ])
      )
    } catch {
      toast.error("Couldn't download the detection log")
    }
  }

  const downloadTelemetry = async () => {
    try {
      const rows = await fetchAllRows(`/api/telemetry?${q}`, telemetryTotal)
      await downloadXlsx(
        `telemetry-log-${sessionLabel}.xlsx`,
        ['TANGGAL', 'WAKTU MISI', 'SESSION ID', 'DURASI MISI', 'WAKTU SENSOR', 'PH', 'SUHU (C)', 'TDS (ppm)', 'DO (mg/L)'],
        rows.map((r: any) => [
          fmtDateIso(r.timestamp), xlsMissionTime, sessionLabel, xlsDuration, fmtClockId(r.timestamp),
          r.phLevel, r.waterTemp, r.tdsValue, r.dissolvedOxygen,
        ])
      )
    } catch {
      toast.error("Couldn't download the sensor log")
    }
  }

  return (
    <div className="space-y-4">
      <MissionPicker
        missions={allSessions}
        selected={session}
        onSelect={id => router.replace(`?session=${id}`, { scroll: false })}
      />

      {/* Mission header */}
      <div className={`${card} px-5 py-4`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
              {fmtDate(session.startTime)} · {fmtClock(session.startTime)}{session.endTime ? ` – ${fmtClock(session.endTime)}` : ' – now'}
            </p>
          </div>
          {recording && (
            <Link
              href={`/dashboard/recordings?play=${recording.id}`}
              className="inline-flex shrink-0 self-start items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
            >
              <Play className="h-3.5 w-3.5" /> Watch recording
            </Link>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-gray-100 pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Fish counted" value={session.totalFish ?? '—'} hint="Most seen at once" />
          <Stat label="Detections" value={detections ? totalDetections.toLocaleString('en-US') : '—'} hint="Boxes across frames" />
          <Stat label="Species" value={detections ? speciesDist.length : '—'} />
          <Stat label="Duration" value={fmtDuration(durationSec * 1000)} />
          <Stat label="Avg confidence" value={avgConfidence > 0 ? `${Math.round(avgConfidence * 100)}%` : '—'} />
          <Stat label="Max depth" value={maxDepth != null ? maxDepth.toFixed(1) : '—'} unit="m" />
        </div>
      </div>

      {/* Detections over time + species ranking */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="text-base font-semibold text-gray-900">Detections over time</h2>
          <p className="text-xs text-gray-500">Detections per minute</p>
          {totalDetections > 0 ? (
            <div className="mt-4 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap={1}>
                  <CartesianGrid vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="t" tickFormatter={t => fmtClock(t)} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} minTickGap={40} tickMargin={8} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} tickMargin={8} />
                  <Tooltip
                    cursor={{ fill: '#f3f4f6' }}
                    labelFormatter={t => fmtClock(Number(t))}
                    formatter={v => [v, 'Detections']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Bar dataKey="detections" fill="#2563eb" radius={[2, 2, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="flex h-48 items-center justify-center text-sm text-gray-400">{detections ? 'No fish detected in this mission' : 'Loading…'}</p>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-base font-semibold text-gray-900">Species</h2>
          <p className="text-xs text-gray-500">Ranked by detections</p>
          {speciesDist.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {speciesDist.map((sp, i) => {
                const color = getSpeciesColor(sp.species)
                return (
                  <li key={sp.species}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-gray-700">{sp.species}</span>
                      <span className="font-medium text-gray-900">
                        {sp.count.toLocaleString('en-US')}
                        <span className="ml-1.5 text-xs font-normal text-gray-500">{Math.round((sp.count / totalDetections) * 100)}%</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                      <div className="h-full rounded-full" style={{ width: `${(sp.count / speciesMax) * 100}%`, backgroundColor: color }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="flex h-40 items-center justify-center text-sm text-gray-400">{detections ? 'No species detected' : 'Loading…'}</p>
          )}
        </div>
      </div>

      {/* Water quality — mission averages */}
      <div>
        <h2 className="mb-2 text-base font-semibold text-gray-900">
          Water quality <span className="text-sm font-normal text-gray-500">· mission average</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {telemetry ? (
            <>
              <SensorCard label="pH" value={hasTelemetry ? s.avgPh : null} range={rangeOf('Ph')} unit="pH" status={getPhStatus} />
              {/* TDS status hidden until the team sets seawater thresholds (old 200–500 ppm = freshwater) */}
              <SensorCard label="TDS" value={hasTelemetry ? s.avgTds : null} range={rangeOf('Tds')} unit="ppm" />
              <SensorCard label="Dissolved oxygen" value={hasTelemetry ? s.avgDo : null} range={rangeOf('Do')} unit="mg/L" status={getDoStatus} />
              <SensorCard label="Water temperature" value={hasTelemetry ? s.avgTemp : null} range={rangeOf('Temp')} unit="°C" status={getTempStatus} />
            </>
          ) : (
            // Neutral placeholder while loading, so a mission never flashes "No data"
            [0, 1, 2, 3].map(i => (
              <div key={i} className={`${card} px-5 py-4`}>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-3 h-8 w-20" />
                <Skeleton className="mt-3 h-3 w-12" />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Both logs are narrow (4–5 columns): side by side on wide screens */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <LogCard title="Detection log" shown={detectionList.length} total={detectionTotal} onDownload={downloadDetections}>
          <table className="w-full text-sm sm:table-fixed">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className={th}>Time</th>
                <th className={th}>Species</th>
                <th className={th}>Confidence</th>
                <th className={th}>Depth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detectionList.length > 0 ? detectionList.map((r, i) => (
                <tr key={r.id}>
                  <td className={`${td} text-gray-500`}>{fmtClock(r.detectedAt, true)}</td>
                  <td className={td}>
                    <span className="inline-flex items-center gap-2 text-gray-900">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getSpeciesColor(r.speciesName) }} />
                      {r.speciesName}
                    </span>
                  </td>
                  <td className={`${td} text-gray-700`}>{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                  <td className={`${td} text-gray-700`}>{r.depthAtDetection != null ? `${r.depthAtDetection.toFixed(1)} m` : '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-400">No detections recorded</td></tr>
              )}
            </tbody>
          </table>
        </LogCard>

        <LogCard
          title="Sensor log" shown={telemetryList.length} total={telemetryTotal} onDownload={downloadTelemetry}
          footer={telemetryList.length > 0 && (
            <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">
              Coloured values are outside the normal range: pH {WATER_RANGES.ph.text}, DO {WATER_RANGES.do.text}, temp {WATER_RANGES.temp.text}.
            </p>
          )}
        >
          <table className="w-full text-sm sm:table-fixed">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className={th}>Time</th>
                <th className={th}>pH</th>
                <th className={th}>Temp °C</th>
                <th className={th}>TDS ppm</th>
                <th className={th}>DO mg/L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {telemetryList.length > 0 ? telemetryList.map(r => (
                <tr key={r.id}>
                  <td className={`${td} text-gray-500`}>{fmtClock(r.timestamp, true)}</td>
                  <td className={td}><Reading value={r.phLevel} digits={1} status={getPhStatus} /></td>
                  <td className={td}><Reading value={r.waterTemp} digits={1} status={getTempStatus} /></td>
                  <td className={td}><Reading value={r.tdsValue} digits={0} /></td>
                  <td className={td}><Reading value={r.dissolvedOxygen} digits={1} status={getDoStatus} /></td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">No sensor readings recorded</td></tr>
              )}
            </tbody>
          </table>
        </LogCard>
      </div>
    </div>
  )
}
