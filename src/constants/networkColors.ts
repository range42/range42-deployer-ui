export interface NetworkColor {
  stroke: string      // edge stroke color
  bg: string          // zone overlay background
  border: string      // zone border and node accent
  label: string       // edge label text
  badgeBg: string     // segment type badge background
}

export const NETWORK_COLORS: Record<string, NetworkColor> = {
  wan:        { stroke: 'light-dark(#b91c1c, #fca5a5)', bg: 'rgba(239,68,68,0.06)',  border: 'rgba(239,68,68,0.4)',  label: 'light-dark(#991b1b, #fca5a5)', badgeBg: '#ef4444' },
  dmz:        { stroke: 'light-dark(#92400e, #fcd34d)', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.4)', label: 'light-dark(#92400e, #fcd34d)', badgeBg: '#f59e0b' },
  lan:        { stroke: 'light-dark(#15803d, #86efac)', bg: 'rgba(34,197,94,0.06)',  border: 'rgba(34,197,94,0.4)',  label: 'light-dark(#166534, #86efac)', badgeBg: '#22c55e' },
  management: { stroke: 'light-dark(#1d4ed8, #93c5fd)', bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.4)', label: 'light-dark(#1e40af, #93c5fd)', badgeBg: '#3b82f6' },
  custom:     { stroke: 'light-dark(#6d28d9, #c4b5fd)', bg: 'rgba(139,92,246,0.06)', border: 'rgba(139,92,246,0.4)', label: 'light-dark(#5b21b6, #c4b5fd)', badgeBg: '#8b5cf6' },
}

export function getNetworkColor(segmentType: string): NetworkColor {
  return NETWORK_COLORS[segmentType] || NETWORK_COLORS.custom
}
