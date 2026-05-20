/**
 * useCanvasHistory — ring-buffer undo/redo for the VueFlow canvas.
 *
 * Callers push snapshots of the current canvas (any serialisable shape —
 * typically `{ nodes, edges }`) after every non-trivial mutation. The
 * buffer retains up to 50 snapshots; older entries are dropped.
 *
 * `undo()` moves the pointer back one step and returns the snapshot the
 * caller should restore; `redo()` moves forward. The caller is
 * responsible for applying the returned snapshot back into the canvas
 * (via `setNodes/setEdges`) — this composable never touches VueFlow
 * directly.
 */

import { computed, ref } from 'vue'

export const CANVAS_HISTORY_SIZE = 50

export interface CanvasHistoryApi<T> {
  push: (snapshot: T) => void
  undo: () => T | null
  redo: () => T | null
  clear: () => void
  canUndo: ReturnType<typeof computed<boolean>>
  canRedo: ReturnType<typeof computed<boolean>>
  readonly size: () => number
}

export function useCanvasHistory<T>(maxSize: number = CANVAS_HISTORY_SIZE): CanvasHistoryApi<T> {
  const buffer = ref<T[]>([]) as { value: T[] }
  // pointer = index of the "current" snapshot in buffer. -1 = empty.
  const pointer = ref(-1)

  function push(snapshot: T): void {
    // Drop any forward history once a new snapshot is pushed on top of
    // an undone state (classical undo/redo semantics).
    if (pointer.value < buffer.value.length - 1) {
      buffer.value = buffer.value.slice(0, pointer.value + 1)
    }
    buffer.value.push(snapshot)
    // Ring-buffer truncation: evict the oldest entries.
    while (buffer.value.length > maxSize) {
      buffer.value.shift()
    }
    pointer.value = buffer.value.length - 1
  }

  function undo(): T | null {
    if (pointer.value <= 0) return null
    pointer.value -= 1
    return buffer.value[pointer.value] ?? null
  }

  function redo(): T | null {
    if (pointer.value >= buffer.value.length - 1) return null
    pointer.value += 1
    return buffer.value[pointer.value] ?? null
  }

  function clear(): void {
    buffer.value = []
    pointer.value = -1
  }

  const canUndo = computed(() => pointer.value > 0)
  const canRedo = computed(() => pointer.value < buffer.value.length - 1)

  return {
    push,
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
    size: () => buffer.value.length,
  }
}
