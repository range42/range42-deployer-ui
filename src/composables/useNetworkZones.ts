import { computed, type Ref } from 'vue'
import { getNetworkColor, type NetworkColor } from '@/constants/networkColors'

export interface ZoneOverlay {
  id: string
  x: number
  y: number
  width: number
  height: number
  color: NetworkColor
  label: string
}

const PADDING = 40

export function useNetworkZones(
  nodes: Ref<any[]>,
  edges: Ref<any[]>,
) {
  const zones = computed<ZoneOverlay[]>(() => {
    const networkNodes = nodes.value.filter(n => n.type === 'network-segment')
    const result: ZoneOverlay[] = []

    for (const netNode of networkNodes) {
      const connectedIds = new Set<string>()
      for (const edge of edges.value) {
        if (edge.source === netNode.id) connectedIds.add(edge.target)
        else if (edge.target === netNode.id) connectedIds.add(edge.source)
      }

      const connectedNodes = nodes.value.filter(n => connectedIds.has(n.id))
      if (connectedNodes.length === 0) continue

      const allNodes = [netNode, ...connectedNodes]

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of allNodes) {
        const w = n.dimensions?.width || 200
        const h = n.dimensions?.height || 80
        minX = Math.min(minX, n.position.x)
        minY = Math.min(minY, n.position.y)
        maxX = Math.max(maxX, n.position.x + w)
        maxY = Math.max(maxY, n.position.y + h)
      }

      const segmentType = netNode.data?.config?.segmentType || 'custom'
      const cidr = netNode.data?.config?.cidr || ''

      result.push({
        id: netNode.id,
        x: minX - PADDING,
        y: minY - PADDING,
        width: (maxX - minX) + PADDING * 2,
        height: (maxY - minY) + PADDING * 2,
        color: getNetworkColor(segmentType),
        label: `${segmentType.toUpperCase()} Zone${cidr ? ' \u00b7 ' + cidr : ''}`,
      })
    }

    return result
  })

  return { zones }
}
