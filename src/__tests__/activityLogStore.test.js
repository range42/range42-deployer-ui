import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useActivityLogStore } from '@/stores/activityLogStore'
import { useDeploymentStore } from '@/stores/deploymentStore'
import { useDeploymentActivityBridge } from '@/composables/useDeploymentActivityBridge'

describe('activityLogStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('push adds an entry and returns its id', () => {
    const s = useActivityLogStore()
    const id = s.push({ source: 'proxmox', level: 'pending', target: 'vm-1', message: 'deleting' })
    expect(s.entries).toHaveLength(1)
    expect(s.entries[0].id).toBe(id)
    expect(s.entries[0].ts).toBeTypeOf('number')
  })

  it('update patches an existing entry by id', () => {
    const s = useActivityLogStore()
    const id = s.push({ source: 'proxmox', level: 'pending', target: 'vm-1', message: 'deleting' })
    s.update(id, { level: 'success', message: 'deleted' })
    expect(s.entries[0].level).toBe('success')
    expect(s.entries[0].message).toBe('deleted')
  })

  it('ring buffer caps at 500', () => {
    const s = useActivityLogStore()
    for (let i = 0; i < 520; i++) {
      s.push({ source: 'proxmox', level: 'info', target: `t${i}`, message: `m${i}` })
    }
    expect(s.entries.length).toBe(500)
    expect(s.entries[s.entries.length - 1].message).toBe('m519')
  })

  it('clear empties the buffer', () => {
    const s = useActivityLogStore()
    s.push({ source: 'deploy', level: 'info', target: 'x', message: 'y' })
    s.clear()
    expect(s.entries).toHaveLength(0)
  })
})

describe('useDeploymentActivityBridge', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function mountBridge() {
    let captured = null
    const store = useDeploymentStore()
    vi.spyOn(store, 'onEvent').mockImplementation((cb) => {
      captured = cb
      return () => {}
    })
    const Comp = defineComponent({
      setup() {
        useDeploymentActivityBridge()
        return () => h('div')
      },
    })
    const wrapper = mount(Comp)
    return { wrapper, fire: (...args) => captured(...args) }
  }

  it('forwards a log_line deploy event into the activity log as info', () => {
    const { fire } = mountBridge()
    fire('dep-1', { event_type: 'log_line', event_seq: 1, payload: { stream: 'stdout', text: 'hello' } })

    const log = useActivityLogStore()
    expect(log.entries.at(-1)).toMatchObject({
      source: 'deploy',
      level: 'info',
      target: 'dep-1',
      message: 'hello',
    })
  })

  it('maps host_unreachable to error level', () => {
    const { fire } = mountBridge()
    fire('dep-2', { event_type: 'host_unreachable', event_seq: 2, payload: { host: 'vm-9001' } })

    const log = useActivityLogStore()
    expect(log.entries.at(-1)).toMatchObject({ source: 'deploy', level: 'error', target: 'dep-2', message: 'vm-9001' })
  })

  it('maps attempt_end with terminal_state deployed to success', () => {
    const { fire } = mountBridge()
    fire('dep-3', { event_type: 'attempt_end', event_seq: 3, payload: { terminal_state: 'deployed' } })

    const log = useActivityLogStore()
    expect(log.entries.at(-1)).toMatchObject({ source: 'deploy', level: 'success', target: 'dep-3' })
  })

  it('does not throw on an unexpected event shape', () => {
    const { fire } = mountBridge()
    expect(() => fire('dep-4', undefined)).not.toThrow()
    const log = useActivityLogStore()
    expect(log.entries.at(-1)).toMatchObject({ source: 'deploy', level: 'info', target: 'dep-4', message: '' })
  })
})
