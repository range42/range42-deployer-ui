import { describe, it, expect } from 'vitest'
import {
  useCanvasHistory,
  CANVAS_HISTORY_SIZE,
} from '@/composables/useCanvasHistory'

describe('useCanvasHistory', () => {
  it('push → undo returns the previous snapshot, redo returns forward again', () => {
    const h = useCanvasHistory()
    h.push({ v: 1 })
    h.push({ v: 2 })
    h.push({ v: 3 })
    expect(h.undo()).toEqual({ v: 2 })
    expect(h.undo()).toEqual({ v: 1 })
    expect(h.undo()).toBeNull() // can't go past the head
    expect(h.redo()).toEqual({ v: 2 })
  })

  it('canUndo / canRedo track pointer position', () => {
    const h = useCanvasHistory()
    expect(h.canUndo.value).toBe(false)
    h.push(1)
    expect(h.canUndo.value).toBe(false)
    h.push(2)
    expect(h.canUndo.value).toBe(true)
    expect(h.canRedo.value).toBe(false)
    h.undo()
    expect(h.canRedo.value).toBe(true)
  })

  it('push after undo discards forward history', () => {
    const h = useCanvasHistory()
    h.push(1)
    h.push(2)
    h.push(3)
    h.undo()
    h.undo() // pointer at snapshot 1
    h.push(99) // should drop 2 + 3 from forward history
    expect(h.canRedo.value).toBe(false)
    expect(h.size()).toBe(2)
  })

  it('ring-buffer truncates at 50 entries (oldest evicted)', () => {
    const h = useCanvasHistory()
    for (let i = 0; i < CANVAS_HISTORY_SIZE + 20; i++) {
      h.push(i)
    }
    expect(h.size()).toBe(CANVAS_HISTORY_SIZE)
    // The head of the buffer should be the 20th pushed (0..19 were evicted).
    // Walk back to the oldest retained entry via repeated undo().
    let lastSeen = null
    while (h.canUndo.value) {
      lastSeen = h.undo()
    }
    expect(lastSeen).toBe(20)
  })

  it('clear() empties the buffer and pointer', () => {
    const h = useCanvasHistory()
    h.push(1)
    h.push(2)
    h.clear()
    expect(h.canUndo.value).toBe(false)
    expect(h.canRedo.value).toBe(false)
    expect(h.size()).toBe(0)
  })
})
