'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { TARGET_SPECIES } from '@/lib/species'
import { WATER_RANGES, SENSOR_LIMITS } from '@/lib/water-quality'
import Header from '@/components/layout/Header'

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm'
const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const listOf = (xs: string[], and: string) => `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`

type Lang = 'id' | 'en'
const LANG_KEY = 'help-lang'
type Faq = Array<{ group: string; items: Array<{ q: string; a: string }> }>

// The Indonesian text quotes button, menu and status names exactly as the (English) app shows them.
// ponytail: two hand-kept copies; edit both when the Help text changes.
const TEXT = {
  en: {
    steps: [
      { title: 'Start stream', text: 'On Live Stream. A mission is created straight away.' },
      { title: 'Mission runs', text: 'Video is recorded and fish and sensor data are saved automatically.' },
      { title: 'Stop', text: 'Ends the stream and the recording. The mission clock stops.' },
      { title: 'Save mission', text: 'Give it a name and location. It then shows up in Mission Report and Trends.' },
    ],
    faq: [
      {
        group: 'Live Stream',
        items: [
          {
            q: 'Nothing appears after I press Start stream',
            a: 'The detection feed needs the ROV camera. If “No video received” shows after 10 seconds, check that the ROV is on the same network and that MediaMTX is running, then press Stop and Start stream again. A mission that never received video is closed as Aborted instead of asking you to save it. To test without the ROV, choose “This device” as the source in Stream settings.',
          },
          {
            q: 'What does Reconnect do?',
            a: 'It reconnects the page to the stream server, for example after the backend was restarted. The status shows “Connecting…” and a message tells you whether it worked. It is disabled while streaming.',
          },
          {
            q: 'What is the Raw camera preview?',
            a: 'An extra view under the detection feed that shows the camera picture straight from MediaMTX, without AI boxes. Use it to check whether a problem comes from the camera or from the detection. It only shows while streaming.',
          },
          {
            q: 'How do I report an error?',
            a: 'Open System log at the bottom of the Live Stream page. It lists what the stream did, with errors in red. Copy the lines around the error, together with the time it happened, and send them to the team.',
          },
          {
            q: 'Is the mission video recorded?',
            a: 'Yes. Recording starts on its own a few seconds after the stream starts and ends when you press Stop. The video appears in Recordings, and the mission’s report links to it with “Watch recording”. If the newest recording isn’t listed yet, refresh the Recordings page.',
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
            a: 'A mission that never received video, that has had no stream for 10 minutes, or that is still running when the server restarts, is closed as Aborted. Its data is kept and still appears in Mission Report and Trends.',
          },
          {
            q: 'How do I rename or delete a mission?',
            a: 'Rename it with the pencil button on its recording in Recordings — admins and the person who ran the mission can do this. Admins can delete a whole mission with “Delete mission” in Mission Report. Deleting only a recording removes the video but keeps the mission report.',
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
            a: `The AI model recognises four species: ${listOf(TARGET_SPECIES, 'and')}. Each box in the detection feed shows the species name and how confident the AI is.`,
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
            a: 'Amber or red means the value is outside the normal range listed under Terms. Blue on TDS means the reading is at the sensor’s limit.',
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
    ] as Faq,
    h: { steps: 'Running a mission', faq: 'Questions', system: 'System', terms: 'Terms' },
    sys: { server: 'Server', model: 'AI model', conf: 'Confidence threshold', device: 'Device', docs: 'API documentation' },
    terms: {
      fish: 'The most of each species seen at once in one frame. Never counts a fish twice, but can miss fish that appear one after another.',
      det: 'Every box the AI draws in every sampled frame. One fish seen in several frames counts several times.',
      status: 'Running while streaming or waiting to be saved; Completed once saved; Aborted when closed automatically.',
      rangesTitle: 'Normal ranges',
      ranges: (tds: string, depth: number) => `TDS has no normal range: open-sea water is above the ${tds} ppm sensor limit, so it shows Above sensor limit. Depth near the ${depth} m sensor limit is flagged on the stream.`,
      doName: 'dissolved oxygen',
      tempName: 'temperature',
    },
  },
  id: {
    steps: [
      { title: 'Start stream', text: 'Di halaman Live Stream. Misi langsung dibuat.' },
      { title: 'Misi berjalan', text: 'Video direkam, data ikan dan sensor tersimpan otomatis.' },
      { title: 'Stop', text: 'Menghentikan stream dan rekaman. Jam misi berhenti.' },
      { title: 'Save mission', text: 'Beri nama dan lokasi. Misi lalu muncul di Mission Report dan Trends.' },
    ],
    faq: [
      {
        group: 'Live Stream',
        items: [
          {
            q: 'Tidak ada gambar setelah menekan Start stream',
            a: 'Tampilan deteksi membutuhkan kamera ROV. Bila muncul “No video received” setelah 10 detik, pastikan ROV ada di jaringan yang sama dan MediaMTX berjalan, lalu tekan Stop dan Start stream lagi. Misi yang tidak pernah menerima video ditutup sebagai Aborted, tanpa diminta disimpan. Untuk mencoba tanpa ROV, pilih “This device” sebagai sumber di Stream settings.',
          },
          {
            q: 'Apa fungsi Reconnect?',
            a: 'Menyambungkan ulang halaman ke server stream, misalnya setelah backend dinyalakan ulang. Status menunjukkan “Connecting…”, lalu muncul pesan berhasil atau tidak. Tombol ini nonaktif selama streaming.',
          },
          {
            q: 'Apa itu Raw camera preview?',
            a: 'Tampilan tambahan di bawah video deteksi yang menunjukkan gambar kamera langsung dari MediaMTX, tanpa kotak AI. Gunakan untuk memeriksa apakah masalah berasal dari kamera atau dari deteksi. Hanya tampil selama streaming.',
          },
          {
            q: 'Bagaimana cara melaporkan error?',
            a: 'Buka System log di bagian bawah halaman Live Stream. Isinya catatan kerja stream, dengan error berwarna merah. Salin baris di sekitar error beserta jam kejadiannya, lalu kirim ke tim.',
          },
          {
            q: 'Apakah video misi direkam?',
            a: 'Ya. Rekaman mulai sendiri beberapa detik setelah stream dimulai dan berhenti saat Stop ditekan. Videonya ada di Recordings, dan laporan misi menautkannya lewat “Watch recording”. Bila rekaman terbaru belum muncul, refresh halaman Recordings.',
          },
          {
            q: 'Kenapa sebagian ikan tidak terdeteksi?',
            a: 'AI hanya menyimpan deteksi yang keyakinannya minimal sebesar ambang di bagian Sistem. Air keruh, cahaya kurang, dan ikan yang jauh dari kamera menurunkan keyakinannya.',
          },
        ],
      },
      {
        group: 'Misi',
        items: [
          {
            q: 'Kenapa nama misi diisi setelah menekan Stop?',
            a: 'Misi dibuat saat stream dimulai, jadi tidak ada data yang hilang selama Anda mengetik. Dialog simpan tidak bisa dilewati: misi tetap Running sampai disimpan.',
          },
          {
            q: 'Kenapa misi saya ditandai Aborted?',
            a: 'Misi yang tidak pernah menerima video, tidak ada stream selama 10 menit, atau masih berjalan saat server dinyalakan ulang, ditutup sebagai Aborted. Datanya tetap tersimpan dan muncul di Mission Report dan Trends.',
          },
          {
            q: 'Bagaimana cara mengganti nama atau menghapus misi?',
            a: 'Ganti nama lewat tombol pensil pada rekamannya di Recordings — bisa dilakukan admin dan orang yang menjalankan misi. Admin bisa menghapus seluruh misi lewat “Delete mission” di Mission Report. Menghapus rekaman saja hanya membuang videonya; laporan misi tetap ada.',
          },
          {
            q: 'Bisakah dua misi berjalan bersamaan?',
            a: 'Tidak. Hanya satu misi yang bisa Running. Stop dan simpan misi yang sedang berjalan sebelum memulai yang baru.',
          },
        ],
      },
      {
        group: 'Deteksi ikan',
        items: [
          {
            q: 'Spesies apa saja yang dideteksi?',
            a: `Model AI mengenali empat spesies: ${listOf(TARGET_SPECIES, 'dan')}. Setiap kotak pada detection feed menampilkan nama spesies dan tingkat keyakinan AI.`,
          },
          {
            q: 'Kenapa “Fish counted” dan “Detections” berbeda?',
            a: 'Keduanya mengukur hal berbeda — lihat Istilah. Detections menghitung setiap kotak yang digambar AI, jadi satu ikan yang terlihat di banyak frame dihitung berkali-kali. Fish counted adalah jumlah terbanyak tiap spesies yang terlihat bersamaan, sehingga satu ikan tidak pernah dihitung dua kali.',
          },
        ],
      },
      {
        group: 'Mission Report & Trends',
        items: [
          {
            q: 'Halaman mana yang sebaiknya dipakai?',
            a: 'Mission Report menampilkan satu misi secara rinci: deteksi per menit, spesies, kualitas air, dan log lengkap. Trends membandingkan misi dalam rentang tanggal. Pilih misi di Trends untuk membuka laporannya.',
          },
          {
            q: 'Bagaimana cara ekspor data ke Excel?',
            a: 'Di Mission Report, tombol Excel pada Detection log dan Sensor log mengunduh semua baris misi itu. Di Trends, tombol Excel mengunduh satu baris per misi untuk rentang yang dipilih.',
          },
          {
            q: 'Kenapa sebagian nilai berwarna?',
            a: 'Kuning atau merah berarti nilainya di luar rentang normal yang tercantum di Istilah. Biru pada TDS berarti bacaan sudah di batas sensor.',
          },
        ],
      },
      {
        group: 'Dashboard',
        items: [
          {
            q: 'Apa yang ditampilkan Dashboard?',
            a: 'Misi yang sedang berjalan, secara langsung. Bila tidak ada, ringkasan misi terakhir: rata-rata kualitas air, dive profile, dan fish counted.',
          },
          {
            q: 'Apa arti “No data”?',
            a: 'Sensor itu tidak mengirim bacaan selama misi. Bukan berarti nilainya nol.',
          },
        ],
      },
    ] as Faq,
    h: { steps: 'Menjalankan misi', faq: 'Pertanyaan', system: 'Sistem', terms: 'Istilah' },
    sys: { server: 'Server', model: 'Model AI', conf: 'Ambang keyakinan', device: 'Perangkat', docs: 'Dokumentasi API' },
    terms: {
      fish: 'Jumlah terbanyak tiap spesies yang terlihat bersamaan dalam satu frame. Satu ikan tidak pernah dihitung dua kali, tetapi ikan yang muncul bergantian bisa terlewat.',
      det: 'Setiap kotak yang digambar AI di setiap frame yang diperiksa. Satu ikan yang terlihat di beberapa frame dihitung beberapa kali.',
      status: 'Running selama streaming atau menunggu disimpan; Completed setelah disimpan; Aborted bila ditutup otomatis.',
      rangesTitle: 'Rentang normal',
      ranges: (tds: string, depth: number) => `TDS tidak punya rentang normal: air laut lepas melebihi batas sensor ${tds} ppm, sehingga tampil Above sensor limit. Kedalaman yang mendekati batas sensor ${depth} m ditandai di stream.`,
      doName: 'oksigen terlarut',
      tempName: 'suhu',
    },
  },
}

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

  // English by default like the rest of the app; the choice is remembered in this browser
  const [lang, setLang] = useState<Lang>('en')
  useEffect(() => {
    try { if (localStorage.getItem(LANG_KEY) === 'id') setLang('id') } catch {}
  }, [])
  const choose = (l: Lang) => {
    setLang(l)
    try { localStorage.setItem(LANG_KEY, l) } catch {}
  }
  const t = TEXT[lang]

  return (
    <>
    <Header title="Help" subtitle={lang === 'id' ? 'Cara menjalankan misi dan membaca hasilnya' : 'How to run a mission and read the results'}>
        <div role="group" aria-label="Language" className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-medium">
          {(['en', 'id'] as const).map(l => (
            <button
              key={l}
              type="button"
              onClick={() => choose(l)}
              aria-pressed={lang === l}
              className={`rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 ${
                lang === l ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
    </Header>
    <main className="px-4 py-4 lg:px-6">
    {/* key remounts the text on a language change so it fades instead of swapping abruptly */}
    <div key={lang} lang={lang} className="space-y-4 pb-8 animate-in fade-in duration-150">

      {/* Mission steps */}
      <section className={`${card} p-5`}>
        <h2 className="text-base font-semibold text-gray-900">{t.h.steps}</h2>
        <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {t.steps.map((s, i) => (
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
          <h2 className="text-base font-semibold text-gray-900">{t.h.faq}</h2>
          <div className="mt-2 space-y-5">
            {t.faq.map(({ group, items }) => (
              <div key={group}>
                <h3 className="text-xs font-medium text-gray-500">{group}</h3>
                <div className="mt-1 divide-y divide-gray-100">
                  {items.map(({ q, a }) => (
                    <details key={q} className="faq-item group">
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
            <h2 className="text-base font-semibold text-gray-900">{t.h.system}</h2>
            <dl className="mt-2 divide-y divide-gray-100">
              <Row label={t.sys.server}>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-green-500' : healthError ? 'bg-red-500' : 'bg-gray-300'}`} />
                  {online ? 'Online' : healthError ? 'Offline' : 'Checking…'}
                </span>
              </Row>
              <Row label={t.sys.model}>{m ? (m.model_loaded ? 'Loaded' : 'Not loaded') : '—'}</Row>
              <Row label={t.sys.conf}>{m?.conf_threshold != null ? `${Math.round(m.conf_threshold * 100)}%` : '—'}</Row>
              {m?.device && <Row label={t.sys.device}><span title={String(m.device)}>{String(m.device)}</span></Row>}
            </dl>
            <a
              href={`${backendUrl}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              {t.sys.docs} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </section>

          {/* Terms */}
          <section className={`${card} p-5`}>
            <h2 className="text-base font-semibold text-gray-900">{t.h.terms}</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="font-medium text-gray-900">Fish counted</dt>
                <dd className="mt-0.5 text-gray-600">{t.terms.fish}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900">Detections</dt>
                <dd className="mt-0.5 text-gray-600">{t.terms.det}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900">Mission status</dt>
                <dd className="mt-0.5 text-gray-600">{t.terms.status}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900">{t.terms.rangesTitle}</dt>
                <dd className="mt-0.5 text-gray-600">
                  pH {WATER_RANGES.ph.text} · {t.terms.doName} {WATER_RANGES.do.text} · {t.terms.tempName} {WATER_RANGES.temp.text}.{' '}
                  {t.terms.ranges(SENSOR_LIMITS.tds.toLocaleString(lang === 'id' ? 'id-ID' : 'en-US'), SENSOR_LIMITS.depth)}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
    </main>
    </>
  )
}
