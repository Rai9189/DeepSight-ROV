// Shared water-quality status so Dashboard and Stream never disagree on the same reading.
// ponytail: provisional ranges taken from the old Stream page — confirm with the team (see TDS reminder).
export type Tone = 'ok' | 'warn' | 'bad' | 'info'
export type WaterStatus = { label: string; tone: Tone }

export const TONE: Record<Tone, { dot: string; text: string }> = {
  ok:   { dot: 'bg-green-500', text: 'text-green-700' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-700' },
  bad:  { dot: 'bg-red-500',   text: 'text-red-700' },
  info: { dot: 'bg-blue-500',  text: 'text-blue-700' },
}

export const WATER_RANGES = {
  ph:   { min: 6.5, max: 8.5, text: '6.5 – 8.5' },
  do:   { min: 6.0, text: '≥ 6.0 mg/L' },
  temp: { min: 26, max: 30, text: '26 – 30 °C' },
}

export function getPhStatus(ph: number): WaterStatus {
  if (ph < WATER_RANGES.ph.min) return { label: 'Low', tone: 'bad' }
  if (ph > WATER_RANGES.ph.max) return { label: 'High', tone: 'warn' }
  return { label: 'Normal', tone: 'ok' }
}

export function getDoStatus(doVal: number): WaterStatus {
  if (doVal < WATER_RANGES.do.min) return { label: 'Low', tone: 'bad' }
  return { label: 'Normal', tone: 'ok' }
}

export function getTempStatus(temp: number): WaterStatus {
  if (temp < WATER_RANGES.temp.min) return { label: 'Cold', tone: 'info' }
  if (temp > WATER_RANGES.temp.max) return { label: 'Hot', tone: 'warn' }
  return { label: 'Normal', tone: 'ok' }
}
