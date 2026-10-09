'use client'

import useSWR from 'swr'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { TARGET_SPECIES } from '@/lib/species'
import { WATER_RANGES } from '@/lib/water-quality'

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm'
const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const listOf = (xs: string[]) => `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

const STEPS = [
  { title: 'Start stream', text: 'On Live Stream. A mission is created straight away.' },
  { title: 'Mission runs', text: 'Video is recorded and fish and sensor data are saved automatically.' },
  { title: 'Stop', text: 'Ends the stream and the recording. The mission clock stops.' },
  { title: 'Save mission', text: 'Give it a name and location. It then shows up in Mission Report and Trends.' },
]

const FAQ: Array<{ group: string; items: Array<{ q: string; a: string }> }> = [
  {
    group: 'Live Stream',
    items: [
      {
        q: 'Nothing appears after I press Start stream',
        a: 'The detection feed needs the ROV camera. If “No video received” shows after 10 seconds, check that the ROV is on the same network and that MediaMTX is running, then press Stop and Start stream again. To test without the ROV, choose “This device” as the source in Stream settings.',
      },
      {
        q: 'Is the mission video recorded?',
        a: 'Yes. Recording starts on its own a few seconds after the stream starts and ends when you press Stop. The video appears in Recordings, and the mission’s report links to it with “Watch recording”.',
      },
      {
        q: 'Why are some fish not detected?',
        a: 'The AI only keeps a detection when it is at least as confident as the threshold shown under System. Murky water, poor light and fish far from the camera lower its confidence.',
      },
    ],
  },
  {
    group: 'Missions',
    items: [
      {
        q: 'Why do I name the mission after pressing Stop?',
        a: 'The mission is created the moment the stream starts, so no data is lost while you type. The save dialog can’t be skipped: the mission stays Running until it is saved.',
      },
      {
        q: 'Why was my mission marked Aborted?',
        a: 'A mission that has had no stream for 10 minutes, or that is still running when the server restarts, is closed as Aborted. Its data is kept and still appears in Mission Report and Trends.',
      },
      {
        q: 'Can two missions run at the same time?',
        a: 'No. Only one mission can be Running. Stop and save the current one before starting another.',
      },
    ],
  },
  {
    group: 'Fish detection',
    items: [
      {
        q: 'Which species are detected?',
        a: `Data is organised around four target species: ${listOf(TARGET_SPECIES)}. The current AI model can’t tell species apart yet, so it labels every fish as “ikan” (fish). Species names will appear once the updated model is installed.`,
      },
      {
        q: 'Why do “Fish counted” and “Detections” differ?',
        a: 'They measure different things — see Terms. Detections counts every box the AI draws, so one fish seen in many frames is counted many times. Fish counted is the most of each species seen at once, which never counts a fish twice.',
      },
    ],
  },
  {
    group: 'Mission Report & Trends',
    items: [
      {
        q: 'Which page should I use?',
        a: 'Mission Report shows one mission in detail: detections per minute, species, water quality and the full logs. Trends compares missions over a date range. Select a mission in Trends to open its report.',
      },
      {
        q: 'How do I export data to Excel?',
        a: 'In Mission Report, the Excel buttons on the Detection log and Sensor log download every row of that mission. In Trends, the Excel button downloads one row per mission for the selected range.',
      },
      {
        q: 'Why are some values coloured?',
        a: 'Amber or red means the value is outside the normal range listed under Terms. TDS has no range yet: the seawater limits are still being set by the team.',
      },
    ],
  },
  {
    group: 'Dashboard',
    items: [
      {
        q: 'What does the Dashboard show?',
        a: 'The running mission, live, while one is in progress. Otherwise a summary of the latest mission: average water quality, the dive profile and fish counted.',
      },
      {
        q: 'What does “No data” mean?',
        a: 'That sensor sent no readings during the mission. It does not mean the value was zero.',
      },
    ],
  },
]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-gray-900">{children}</dd>
    </div>
  )
}

export default function HelpContent() {
  // Live values instead of hard-coded versions; /api/health is public, /api/model-info needs login
  const { data: health, error: healthError } = useSWR('/api/health', apiClient.swrFetcher, { refreshInterval: 30000 })
  const { data: model } = useSWR('/api/model-info', apiClient.swrFetcher)
  const h = health as any
  const m = model as any
  const online = !!h && !healthError

  return (
    <div className="space-y-4 pb-8">
      {/* Mission steps */}
      <section className={`${card} p-5`}>
        <h2 className="text-base font-semibold text-gray-900">Running a mission</h2>
        <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">{i + 1}</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{s.title}</p>
                <p className="mt-0.5 text-sm text-gray-500">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* Questions */}
        <section className={`${card} p-5 lg:col-span-2`}>
          <h2 className="text-base font-semibold text-gray-900">Questions</h2>
          <div className="mt-2 space-y-5">
            {FAQ.map(({ group, items }) => (
              <div key={group}>
                <h3 className="text-xs font-medium text-gray-500">{group}</h3>
                <div className="mt-1 divide-y divide-gray-100">
                  {items.map(({ q, a }) => (
                    <details key={q} className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-2.5 text-sm font-medium text-gray-900 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                        {q}
                      </summary>
                      <p className="pb-3 pl-6 text-sm leading-relaxed text-gray-600">{a}</p>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-4">
          {/* System */}
          <section className={`${card} p-5`}>
            <h2 className="text-base font-semibold text-gray-900">System</h2>
            <dl className="mt-2 divide-y divide-gray-100">
              <Row label="Server">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-green-500' : healthError ? 'bg-red-500' : 'bg-gray-300'}`} />
                  {online ? 'Online' : healthError ? 'Offline' : 'Checking…'}
                </span>
              </Row>
              <Row label="AI model">{m ? (m.model_loaded ? 'Loaded' : 'Not loaded') : '—'}</Row>
              <Row label="Confidence threshold">{m?.conf_threshold != null ? `${Math.round(m.conf_threshold * 100)}%` : '—'}</Row>
              {m?.device && <Row label="Device"><span title={String(m.device)}>{String(m.device)}</span></Row>}
            </dl>
            <a
              href={`${backendUrl}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              API documentation <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </section>

          {/* Terms */}
          <section className={`${card} p-5`}>
            <h2 className="text-base font-semibold text-gray-900">Terms</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="font-medium text-gray-900">Fish counted</dt>
                <dd className="mt-0.5 text-gray-600">The most of each species seen at once in one frame. Never counts a fish twice, but can miss fish that appear one after another.</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900">Detections</dt>
                <dd className="mt-0.5 text-gray-600">Every box the AI draws in every sampled frame. One fish seen in several frames counts several times.</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900">Mission status</dt>
                <dd className="mt-0.5 text-gray-600">Running while streaming or waiting to be saved; Completed once saved; Aborted when closed automatically.</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900">Normal ranges</dt>
                <dd className="mt-0.5 text-gray-600">
                  pH {WATER_RANGES.ph.text} · dissolved oxygen {WATER_RANGES.do.text} · temperature {WATER_RANGES.temp.text}. TDS: not set yet.
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
