import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { usePendingChanges } from '@/composables/usePendingChanges'

function makeNodeData(desired: Record<string, unknown>, actual: Record<string, unknown>) {
  return ref({
    deployed: true,
    desiredConfig: desired,
    actualConfig: actual,
  })
}

describe('usePendingChanges', () => {
  it('returns empty when desired matches actual', () => {
    const data = makeNodeData(
      { name: 'web01', cores: 2, memory: 2048, tags: ['admin'] },
      { name: 'web01', cores: 2, memory: 2048, tags: ['admin'] },
    )
    const { pendingChanges, hasPendingChanges } = usePendingChanges(data)
    expect(hasPendingChanges.value).toBe(false)
    expect(pendingChanges.value).toHaveLength(0)
  })

  it('detects tag changes', () => {
    const data = makeNodeData(
      { tags: ['admin', 'web'] },
      { tags: ['admin'] },
    )
    const { pendingChanges } = usePendingChanges(data)
    expect(pendingChanges.value).toHaveLength(1)
    expect(pendingChanges.value[0].field).toBe('tags')
    expect(pendingChanges.value[0].category).toBe('live')
  })

  it('detects core changes as restart category', () => {
    const data = makeNodeData({ cores: 4 }, { cores: 2 })
    const { pendingChanges, restartChanges } = usePendingChanges(data)
    expect(pendingChanges.value).toHaveLength(1)
    expect(restartChanges.value).toHaveLength(1)
    expect(restartChanges.value[0].field).toBe('cores')
    expect(restartChanges.value[0].desired).toBe(4)
    expect(restartChanges.value[0].actual).toBe(2)
  })

  it('detects memory changes as restart category', () => {
    const data = makeNodeData({ memory: 4096 }, { memory: 2048 })
    const { restartChanges } = usePendingChanges(data)
    expect(restartChanges.value).toHaveLength(1)
    expect(restartChanges.value[0].field).toBe('memory')
  })

  it('detects name changes as live category', () => {
    const data = makeNodeData({ name: 'new-name' }, { name: 'old-name' })
    const { liveChanges } = usePendingChanges(data)
    expect(liveChanges.value).toHaveLength(1)
    expect(liveChanges.value[0].field).toBe('name')
  })

  it('detects multiple changes across categories', () => {
    const data = makeNodeData(
      { name: 'new', cores: 4, tags: ['admin', 'web'] },
      { name: 'old', cores: 2, tags: ['admin'] },
    )
    const { pendingChanges, liveChanges, restartChanges } = usePendingChanges(data)
    expect(pendingChanges.value).toHaveLength(3)
    expect(liveChanges.value).toHaveLength(2)
    expect(restartChanges.value).toHaveLength(1)
  })

  it('revertField resets a single field', () => {
    const data = makeNodeData({ name: 'new', cores: 4 }, { name: 'old', cores: 2 })
    const { revertField, pendingChanges } = usePendingChanges(data)
    expect(pendingChanges.value).toHaveLength(2)
    revertField('name')
    expect(data.value.desiredConfig.name).toBe('old')
    expect(pendingChanges.value).toHaveLength(1)
  })

  it('revertAll resets all fields', () => {
    const data = makeNodeData(
      { name: 'new', cores: 4, tags: ['web'] },
      { name: 'old', cores: 2, tags: ['admin'] },
    )
    const { revertAll, hasPendingChanges } = usePendingChanges(data)
    expect(hasPendingChanges.value).toBe(true)
    revertAll()
    expect(hasPendingChanges.value).toBe(false)
    expect(data.value.desiredConfig.name).toBe('old')
    expect(data.value.desiredConfig.cores).toBe(2)
    expect(data.value.desiredConfig.tags).toEqual(['admin'])
  })

  it('updateDesired changes a single field', () => {
    const data = makeNodeData({ cores: 2 }, { cores: 2 })
    const { updateDesired, pendingChanges } = usePendingChanges(data)
    expect(pendingChanges.value).toHaveLength(0)
    updateDesired('cores', 8)
    expect(data.value.desiredConfig.cores).toBe(8)
    expect(pendingChanges.value).toHaveLength(1)
  })

  it('returns empty when node is not deployed', () => {
    const data = ref({ deployed: false, desiredConfig: { cores: 4 }, actualConfig: { cores: 2 } })
    const { hasPendingChanges } = usePendingChanges(data)
    expect(hasPendingChanges.value).toBe(false)
  })

  it('returns empty when configs are missing', () => {
    const data = ref({ deployed: true })
    const { hasPendingChanges } = usePendingChanges(data)
    expect(hasPendingChanges.value).toBe(false)
  })

  it('handles tag order insensitivity', () => {
    const data = makeNodeData({ tags: ['web', 'admin'] }, { tags: ['admin', 'web'] })
    const { hasPendingChanges } = usePendingChanges(data)
    expect(hasPendingChanges.value).toBe(false)
  })
})
