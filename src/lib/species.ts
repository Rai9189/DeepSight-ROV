// Target species — keep in sync with SPECIES in src/backend/seed.py
export const TARGET_SPECIES = ['Kerapu', 'Bandeng', 'Nila Salin', 'Bawal Bintang']

const SPECIES_COLORS: Record<string, string> = {
  Kerapu: '#3b82f6',
  Bandeng: '#22c55e',
  'Nila Salin': '#f97316',
  'Bawal Bintang': '#a855f7',
  Lainnya: '#9ca3af',
  Unknown: '#9ca3af',
}
const FALLBACK_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ec4899', '#9ca3af']

export function getSpeciesColor(name: string, idx: number) {
  return SPECIES_COLORS[name] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
}
