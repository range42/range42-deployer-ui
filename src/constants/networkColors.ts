export interface NetworkColor {
  stroke: string      // edge stroke color
  bg: string          // zone overlay background
  border: string      // zone border and node accent
  label: string       // edge label text
  badgeBg: string     // segment type badge background
}

export const NETWORK_COLORS: Record<string, NetworkColor> = {
  wan:        { stroke: '#ef4444', bg: 'rgba(239,68,68,0.06)',  border: 'rgba(239,68,68,0.25)',  label: '#ef4444', badgeBg: '#ef4444' },
  dmz:        { stroke: '#f59e0b', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.25)', label: '#f59e0b', badgeBg: '#f59e0b' },
  lan:        { stroke: '#22c55e', bg: 'rgba(34,197,94,0.06)',  border: 'rgba(34,197,94,0.25)',  label: '#22c55e', badgeBg: '#22c55e' },
  management: { stroke: '#3b82f6', bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.25)', label: '#3b82f6', badgeBg: '#3b82f6' },
  custom:     { stroke: '#8b5cf6', bg: 'rgba(139,92,246,0.06)', border: 'rgba(139,92,246,0.25)', label: '#8b5cf6', badgeBg: '#8b5cf6' },
}

export function getNetworkColor(segmentType: string): NetworkColor {
  return NETWORK_COLORS[segmentType] || NETWORK_COLORS.custom
}
