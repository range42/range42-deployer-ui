import { describe, it, expect } from 'vitest'
import { resolveNodeStatus } from '@/composables/useNodeStatus'

describe('resolveNodeStatus', () => {
  it('maps semantic statuses', () => {
    expect(resolveNodeStatus('running').dotColor).toBe('green')
    expect(resolveNodeStatus('stopped').dotColor).toBe('gray')
    expect(resolveNodeStatus('paused').dotColor).toBe('orange')
    expect(resolveNodeStatus('error').dotColor).toBe('red')
    expect(resolveNodeStatus('deploying').dotColor).toBe('blue')
  })
  it('maps color aliases', () => {
    expect(resolveNodeStatus('green').dotColor).toBe('green')
    expect(resolveNodeStatus('red').dotColor).toBe('red')
    expect(resolveNodeStatus(undefined).dotColor).toBe('gray')
  })
  it('pendingAction overrides with transitional color + label + pulse', () => {
    const del = resolveNodeStatus('stopped', 'delete')
    expect(del.dotColor).toBe('red')
    expect(del.label).toBe('deleting')
    expect(del.pulse).toBe(true)
    expect(resolveNodeStatus('running', 'stop').dotColor).toBe('orange')
    expect(resolveNodeStatus('running', 'stop').pulse).toBe(true)
    expect(resolveNodeStatus('stopped', 'start').dotColor).toBe('blue')
    expect(resolveNodeStatus('paused', 'resume').dotColor).toBe('blue')
  })
  it('error is steady (no pulse), deleting pulses to disambiguate from error', () => {
    expect(resolveNodeStatus('error').pulse).toBe(false)
    expect(resolveNodeStatus('stopped', 'delete').pulse).toBe(true)
  })
})
