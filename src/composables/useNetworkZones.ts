import { computed, type Ref } from 'vue'
import type { Dimensions, XYPosition } from '@vue-flow/core'
import { getNetworkColor, type NetworkColor } from '@/constants/networkColors'
import { connectedNetworkDevices } from '@/services/networkConnections'

export interface ZoneOverlay {
  id: string
  x: number
  y: number
  width: number
  height: number
  color: NetworkColor
  label: string
  kind: 'group' | 'network'
}

const PADDING = 40

/** Only the measured geometry and network metadata used by this overlay. */
export interface NetworkZoneNode {
  id: string
  type?: string
  position: XYPosition
  computedPosition?: XYPosition
  dimensions?: Dimensions
  parentNode?: string
  data?: { kind?: string; config?: { name?: string; segmentType?: string; cidr?: string } }
}
export interface NetworkZoneEdge { source: string; target: string; data?: Record<string, unknown> }

export function useNetworkZones(
  nodes: Readonly<Ref<readonly NetworkZoneNode[]>>,
  edges: Readonly<Ref<readonly NetworkZoneEdge[]>>,
  // Optional reactive trigger (e.g. bumped on VueFlow's `nodes-initialized`
  // event). Reading it inside the computed forces geometry to recompute once
  // node dimensions have been measured, so first-paint zones are not clipped.
  measureTick?: Ref<number>,
) {
  const zones = computed<ZoneOverlay[]>(() => {
    // Establish a reactive dependency on the measurement trigger.
    void measureTick?.value
    const networkNodes = nodes.value.filter(n => n.type === 'network-segment')
    const result: ZoneOverlay[] = []

    for (const group of nodes.value.filter(node => node.type === 'group')) {
      if (!group.dimensions?.width || !group.dimensions?.height) continue
      const position = group.computedPosition ?? group.position
      const team = group.data?.kind === 'team_scope'
      result.push({
        id: group.id, kind: 'group', ...position,
        width: group.dimensions.width, height: group.dimensions.height, label: '',
        color: {
          stroke: team ? '#6366f1' : '#64748b', label: team ? '#6366f1' : '#64748b',
          badgeBg: team ? '#6366f1' : '#64748b',
          bg: team ? 'rgba(99,102,241,0.04)' : 'rgba(100,116,139,0.035)',
          border: team ? 'rgba(99,102,241,0.35)' : 'rgba(100,116,139,0.3)',
        },
      })
    }

    for (const netNode of networkNodes) {
      const connectedNodes = connectedNetworkDevices(netNode.id, nodes.value, edges.value)
      if (connectedNodes.length === 0) continue

      const allNodes = [netNode, ...connectedNodes]

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      let measured = 0
      for (const n of allNodes) {
        // Skip nodes VueFlow has not measured yet — a hardcoded fallback size
        // clips the zone on first paint. Geometry recomputes once the
        // `nodes-initialized` event fires and dimensions become available.
        const w = n.dimensions?.width
        const h = n.dimensions?.height
        if (!w || !h) continue
        // Use the absolute (computedPosition) coordinates so nodes nested in a
        // topology_group / team_scope group — whose `position` is parent-RELATIVE —
        // are placed correctly. Mirrors useDragAndDrop.js which reads computedPosition.
        const pos = n.computedPosition ?? n.position
        minX = Math.min(minX, pos.x)
        minY = Math.min(minY, pos.y)
        maxX = Math.max(maxX, pos.x + w)
        maxY = Math.max(maxY, pos.y + h)
        measured++
      }

      // Nothing measured yet — emit no box rather than a clipped one.
      if (measured === 0) continue

      const segmentType = netNode.data?.config?.segmentType || 'custom'
      const cidr = netNode.data?.config?.cidr || ''

      result.push({
        id: netNode.id,
        kind: 'network',
        x: minX - PADDING,
        y: minY - PADDING,
        width: (maxX - minX) + PADDING * 2,
        height: (maxY - minY) + PADDING * 2,
        color: getNetworkColor(segmentType),
        label: `${netNode.data?.config?.name || segmentType.toUpperCase()}${cidr ? ' \u00b7 ' + cidr : ''}`,
      })
    }

    // Paint largest zones first so smaller / nested boxes (and their labels)
    // are not buried underneath an overlapping larger zone.
    result.sort((a, b) => (b.width * b.height) - (a.width * a.height) || a.id.localeCompare(b.id))

    return result
  })

  return { zones }
}
