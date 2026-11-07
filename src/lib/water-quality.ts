// Shared water-quality status so Dashboard and Stream never disagree on the same reading.
// General seawater ranges (not tied to one fish species), agreed 2026-11-05; the team may still refine them.
export type Tone = 'ok' | 'warn' | 'bad' | 'info'
export type WaterStatus = { label: string; tone: Tone }

export const TONE: Record<Tone, { dot: string; text: string }> = {
  ok:   { dot: 'bg-green-500', text: 'text-green-700' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-700' },
  bad:  { dot: 'bg-red-500',   text: 'text-red-700' },
  info: { dot: 'bg-blue-500',  text: 'text-blue-700' },
}

export const WATER_RANGES = {
  ph:   { min: 7.0, max: 8.5, text: '7.0 – 8.5' },
  do:   { min: 5.0, text: '≥ 5.0 mg/L' },
  temp: { min: 26, max: 32, text: '26 – 32 °C' },
}

// What the ROV's sensors can measure. Seawater TDS (~35,000 ppm) is above the TDS sensor's ceiling.
export const SENSOR_LIMITS = { tds: 20000, depth: 10 }
export const DEPTH_WARN_M = 9

export function getPhStatus(ph: number): WaterStatus {
  if (ph < WATER_RANGES.ph.min) return { label: 'Acidic', tone: 'bad' }
  if (ph > WATER_RANGES.ph.max) return { label: 'Alkaline', tone: 'warn' }
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

// No Normal/Low for TDS: in open sea any reading under the ceiling says little on its own.
export function getTdsStatus(tds: number): WaterStatus | null {
  return tds >= SENSOR_LIMITS.tds ? { label: 'Above sensor limit', tone: 'info' } : null
}

export const isDepthNearLimit = (depth: number) => depth >= DEPTH_WARN_M
