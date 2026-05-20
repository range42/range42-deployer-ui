/**
 * Unit tests for keyboard navigation helpers on the Canvas (Plan C §C5.3).
 *
 * The helpers are pure and operate on a flat nodes array (VueFlow shape:
 * `{ id, position: { x, y } }`). The canvas selects the nearest node in the
 * direction of travel and Enter opens the config panel.
 */
import { describe, it, expect } from 'vitest'
import {
  findNearestNodeInDirection,
  nextKeyboardSelection,
} from '../composables/useInfraBuilder'

const G = (id, x, y) => ({ id, position: { x, y }, type: 'vm' })

describe('findNearestNodeInDirection', () => {
  const nodes = [
    G('a', 0, 0),
    G('b', 100, 0),
    G('c', -100, 0),
    G('d', 0, 100),
    G('e', 0, -100),
    G('f', 300, 10),
  ]

  it('finds nearest node to the right', () => {
    const got = findNearestNodeInDirection(nodes, 'a', 'right')
    expect(got?.id).toBe('b')
  })
  it('finds nearest node to the left', () => {
    const got = findNearestNodeInDirection(nodes, 'a', 'left')
    expect(got?.id).toBe('c')
  })
  it('finds nearest node downward', () => {
    const got = findNearestNodeInDirection(nodes, 'a', 'down')
    expect(got?.id).toBe('d')
  })
  it('finds nearest node upward', () => {
    const got = findNearestNodeInDirection(nodes, 'a', 'up')
    expect(got?.id).toBe('e')
  })
  it('returns null when no node lies in that direction', () => {
    const single = [G('only', 0, 0)]
    expect(findNearestNodeInDirection(single, 'only', 'right')).toBe(null)
  })
  it('returns null when from node is missing', () => {
    expect(findNearestNodeInDirection(nodes, 'missing', 'right')).toBe(null)
  })
  it('prefers the closer node when multiple lie in the direction', () => {
    const got = findNearestNodeInDirection(nodes, 'a', 'right')
    expect(got?.id).toBe('b') // not 'f' which is farther
  })
})

describe('nextKeyboardSelection', () => {
  const nodes = [G('a', 0, 0), G('b', 100, 0), G('c', 0, 100)]

  it('returns first node when no selection yet', () => {
    expect(nextKeyboardSelection(nodes, null, 'right')?.id).toBe('a')
  })
  it('returns first node when selection is not in list', () => {
    expect(nextKeyboardSelection(nodes, 'xxx', 'down')?.id).toBe('a')
  })
  it('delegates to findNearestNodeInDirection for valid selection', () => {
    expect(nextKeyboardSelection(nodes, 'a', 'right')?.id).toBe('b')
    expect(nextKeyboardSelection(nodes, 'a', 'down')?.id).toBe('c')
  })
  it('returns current node when no neighbour in direction', () => {
    expect(nextKeyboardSelection(nodes, 'b', 'right')?.id).toBe('b')
  })
  it('returns null on empty node list', () => {
    expect(nextKeyboardSelection([], null, 'right')).toBe(null)
  })
})
