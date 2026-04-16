import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  validateDockerNode,
  computeDockerTetherEdges,
  findNearestDockerHost,
} from '../composables/useInfraBuilder'

// Stub VueFlow bits — DockerNode only needs Handle/Position/useVueFlow shells.
vi.mock('@vue-flow/core', () => ({
  Handle: { name: 'HandleStub', props: ['type', 'position'], template: '<div class="handle-stub" />' },
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  useVueFlow: () => ({ findNode: () => null }),
}))

import DockerNode from '../components/nodes/DockerNode.vue'

describe('Docker validator — host_ref must be vm|lxc (Plan C §7)', () => {
  const hosts = [
    { id: 'vm-1', type: 'vm', position: { x: 0, y: 0 } },
    { id: 'lxc-1', type: 'lxc', position: { x: 500, y: 0 } },
    { id: 'net-1', type: 'network-segment', position: { x: 100, y: 100 } },
    { id: 'router-1', type: 'router', position: { x: 200, y: 200 } },
  ]

  it('flags missing host_ref', () => {
    const out = validateDockerNode({ id: 'd1', type: 'docker', data: {} }, hosts)
    expect(out.ok).toBe(false)
    expect(out.code).toBe('docker.host_ref.missing')
  })

  it('flags host_ref pointing at a nonexistent node', () => {
    const out = validateDockerNode(
      { id: 'd1', type: 'docker', data: { host_ref: 'ghost' } },
      hosts,
    )
    expect(out.ok).toBe(false)
    expect(out.code).toBe('docker.host_ref.unresolved')
  })

  it('flags host_ref pointing at a non-vm/lxc (e.g. network-segment, router)', () => {
    const netCase = validateDockerNode(
      { id: 'd1', type: 'docker', data: { host_ref: 'net-1' } },
      hosts,
    )
    expect(netCase.ok).toBe(false)
    expect(netCase.code).toBe('docker.host_ref.invalid_type')

    const routerCase = validateDockerNode(
      { id: 'd1', type: 'docker', data: { host_ref: 'router-1' } },
      hosts,
    )
    expect(routerCase.ok).toBe(false)
    expect(routerCase.code).toBe('docker.host_ref.invalid_type')
  })

  it('accepts vm or lxc host_ref', () => {
    expect(
      validateDockerNode({ id: 'd1', type: 'docker', data: { host_ref: 'vm-1' } }, hosts).ok,
    ).toBe(true)
    expect(
      validateDockerNode({ id: 'd1', type: 'docker', data: { host_ref: 'lxc-1' } }, hosts).ok,
    ).toBe(true)
  })

  it('also reads host_ref from data.config.host_ref as a fallback', () => {
    const out = validateDockerNode(
      { id: 'd1', type: 'docker', data: { config: { host_ref: 'vm-1' } } },
      hosts,
    )
    expect(out.ok).toBe(true)
  })
})

describe('computeDockerTetherEdges', () => {
  it('emits one dashed tether per valid docker + skips invalid hosts', () => {
    const nodes = [
      { id: 'vm-1', type: 'vm' },
      { id: 'lxc-1', type: 'lxc' },
      { id: 'net-1', type: 'network-segment' },
      { id: 'd1', type: 'docker', data: { host_ref: 'vm-1' } },
      { id: 'd2', type: 'docker', data: { host_ref: 'net-1' } },  // invalid
      { id: 'd3', type: 'docker', data: {} },                      // missing
      { id: 'd4', type: 'docker', data: { host_ref: 'lxc-1' } },
    ]
    const tethers = computeDockerTetherEdges(nodes)
    expect(tethers).toHaveLength(2)
    expect(tethers.map((e) => e.type)).toEqual(['docker-tether', 'docker-tether'])
    expect(tethers[0].source).toBe('d1')
    expect(tethers[0].target).toBe('vm-1')
    expect(tethers[0].id).toBe('docker-tether-d1-vm-1')
    expect(tethers[1].source).toBe('d4')
  })
})

describe('findNearestDockerHost', () => {
  it('returns the nearest vm|lxc to a drop position', () => {
    const nodes = [
      { id: 'vm-far', type: 'vm', position: { x: 1000, y: 1000 } },
      { id: 'lxc-near', type: 'lxc', position: { x: 10, y: 10 } },
      { id: 'router-1', type: 'router', position: { x: 0, y: 0 } }, // ignored
    ]
    const host = findNearestDockerHost(nodes, { x: 0, y: 0 })
    expect(host?.id).toBe('lxc-near')
  })

  it('returns null when no hosts exist — Problems panel will catch this at drop', () => {
    const nodes = [{ id: 'net-1', type: 'network-segment', position: { x: 0, y: 0 } }]
    expect(findNearestDockerHost(nodes, { x: 0, y: 0 })).toBeNull()
  })
})

describe('DockerNode component — red dot surfaces invalid host_ref', () => {
  it('shows the red missing-host dot when host_ref is empty', () => {
    const wrapper = mount(DockerNode, { props: { id: 'd1', data: { type: 'docker' }, selected: false } })
    expect(wrapper.find('[data-testid="docker-missing-host-d1"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('unset')
  })

  it('hides the red dot when host_ref resolves to a vm host', async () => {
    // Re-mock useVueFlow to resolve the host as a vm
    vi.resetModules()
    vi.doMock('@vue-flow/core', () => ({
      Handle: { name: 'HandleStub', props: ['type', 'position'], template: '<div class="handle-stub" />' },
      Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
      useVueFlow: () => ({ findNode: (id) => (id === 'vm-1' ? { id: 'vm-1', type: 'vm' } : null) }),
    }))
    const { default: FreshDockerNode } = await import('../components/nodes/DockerNode.vue')
    const wrapper = mount(FreshDockerNode, {
      props: { id: 'd2', data: { type: 'docker', host_ref: 'vm-1' }, selected: false },
    })
    expect(wrapper.find('[data-testid="docker-missing-host-d2"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('vm-1')
    vi.doUnmock('@vue-flow/core')
  })
})
