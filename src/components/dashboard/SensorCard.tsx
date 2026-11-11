import { TONE, type WaterStatus } from '@/lib/water-quality'

// Water-quality reading card shared by Dashboard and Stream. Missing data shows "—", never 0.0.
export default function SensorCard({ label, value, unit, status, hint, range }: {
  label: string
  value: number | null | undefined
  unit: string
  status?: (v: number) => WaterStatus | null
  hint?: string
  // Lowest/highest reading behind an average; an out-of-range extreme gets its status colour
  range?: { min: number; max: number }
}) {
  const has = value != null
  const s = has && status ? status(value) : null
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-2 flex items-baseline gap-1">
        <span className={`text-3xl font-semibold tracking-tight ${has ? 'text-gray-900' : 'text-gray-300'}`}>
          {has ? value.toFixed(unit === 'ppm' ? 0 : 1) : '—'}
        </span>
        {has && <span className="text-sm text-gray-500">{unit}</span>}
      </p>
      <p className="mt-2 flex h-4 items-center gap-1.5 text-xs font-medium">
        {!has && <span className="text-gray-500">No data</span>}
        {s && (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${TONE[s.tone].dot}`} />
            <span className={TONE[s.tone].text}>{s.label}</span>
          </>
        )}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {has && range && (
        <p className="mt-1 text-xs text-gray-500">
          {(['min', 'max'] as const).map((k, i) => {
            const v = range[k]
            const tone = status?.(v)?.tone
            return (
              <span key={k}>
                {i > 0 && ' · '}{k}{' '}
                <span className={tone && tone !== 'ok' ? `font-medium ${TONE[tone].text}` : 'text-gray-700'}>
                  {v.toFixed(unit === 'ppm' ? 0 : 1)}
                </span>
              </span>
            )
          })}
        </p>
      )}
    </div>
  )
}
