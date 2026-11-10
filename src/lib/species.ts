// Species the AI model (models/best.pt) reports — listed on the Help page
export const TARGET_SPECIES = ['Bandeng', 'Bawal', 'Kerapu', 'Nila']

const SPECIES_COLORS: Record<string, string> = {
  Kerapu: '#3b82f6',
  Bandeng: '#22c55e',
  Nila: '#f97316',
  Bawal: '#a855f7',
  Lainnya: '#9ca3af',
  Unknown: '#9ca3af',
}
// Other classes (e.g. YOLO's generic "ikan") must never share a target species' colour
const FALLBACK_COLORS = ['#ec4899', '#14b8a6', '#eab308', '#0ea5e9', '#84cc16', '#9ca3af']

// Picked from the name (not list position) so a species keeps one colour on every page
// The second argument is ignored; it only keeps older callers (committed Stream page) compiling
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getSpeciesColor(name: string, _legacyIndex?: number) {
  if (SPECIES_COLORS[name]) return SPECIES_COLORS[name]
  const hash = [...(name || '')].reduce((h, c) => h + c.charCodeAt(0), 0)
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}
