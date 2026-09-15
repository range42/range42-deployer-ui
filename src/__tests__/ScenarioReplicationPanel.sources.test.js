import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ScenarioReplicationPanel from '@/components/project/ScenarioReplicationPanel.vue'
import { replicatedScenario } from './fixtures/replicatedScenario'

function panel(input) {
  let wrapper
  wrapper = mount(ScenarioReplicationPanel, { props: {
    modelValue: input.scenario.replication, scenario: input.scenario,
    projectId: 'course-1', nodes: input.nodes, edges: input.edges,
    'onUpdate:modelValue': value => wrapper.setProps({ modelValue: value }),
  } })
  return wrapper
}

describe('replication source reconciliation', () => {
  it('reviews added and removed sources, preserves existing scopes and assignments, and scaffolds new instances only on request', async () => {
    const input = replicatedScenario()
    input.scenario.replication.node_scopes.removed = 'per_team'
    input.scenario.replication.network_scopes.old_lan = 'per_user'
    input.scenario.replication.vm_assignments['old-instance'] = { vm_id: 4100, nics: {} }
    const original = structuredClone(input.scenario.replication)
    input.nodes.push({ id: 'vm2', type: 'vm', data: { replication: { scope: 'per_user' } } })
    input.edges.push({ id: 'second-primary', source: 'vm2', target: 'net1' })
    input.scenario.vms.push({ ...structuredClone(input.scenario.vms[0]), node_id: 'vm2', vm_name: 'second',
      nics: [{ key: 'second-primary', network_id: 'net1', ip: '' }] })
    const wrapper = panel(input)
    expect(wrapper.get('[data-testid="replication-source-review"]').text()).toContain('vm2')
    expect(wrapper.get('[data-testid="replication-source-review"]').text()).toContain('removed')
    expect(wrapper.get('[data-testid="replication-source-review"]').text()).toContain('old_lan')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.get('[data-testid="replication-reconcile-sources"]').trigger('click')
    const updated = wrapper.emitted('update:modelValue')[0][0]
    expect(updated.node_scopes).toEqual({ vm1: 'per_user', vm2: 'per_user' })
    expect(updated.network_scopes).toEqual({ net1: 'per_team' })
    for (const [key, assigned] of Object.entries(original.vm_assignments)) expect(updated.vm_assignments[key]).toEqual(assigned)
    expect(updated.network_assignments).toEqual(original.network_assignments)
    expect(updated.teams).toEqual(original.teams)
    expect(updated.scenario_id).toBe(original.scenario_id)
    expect(Object.keys(updated.vm_assignments)).toHaveLength(Object.keys(original.vm_assignments).length + 3)
    expect(wrapper.get('[data-testid="replication-counts"]').text()).toMatch(/6 VMs.*2 networks.*6 NICs/)
    expect(input.scenario.replication).toEqual(original)
    expect(wrapper.find('[data-testid="replication-source-review"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('uses explicit existing scopes instead of changed canvas hints', () => {
    const input = replicatedScenario()
    input.nodes[0].data.replication = { scope: 'shared' }
    const wrapper = panel(input)
    expect(wrapper.find('[data-testid="replication-source-review"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="replication-counts"]').text()).toMatch(/3 VMs/)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('previews a newly connected network using its group hint and retains all existing network assignments', async () => {
    const input = replicatedScenario()
    input.nodes.push({ id: 'group', type: 'group', data: { kind: 'team_scope' } },
      { id: 'net2', type: 'network-segment', parentNode: 'group', data: {} })
    input.edges.push({ id: 'secondary', source: 'vm1', target: 'net2' })
    input.scenario.vms[0].nics.push({ key: 'secondary', network_id: 'net2', ip: '' })
    input.scenario.networks.push({ id: 'net2', vnet: 'newnet', subnet: '', gateway: '', snat: false })
    const previous = structuredClone(input.scenario.replication.network_assignments)
    const wrapper = panel(input)
    const review = wrapper.get('[data-testid="replication-source-review"]')
    expect(review.text()).toContain('net2')
    expect(review.text()).toContain('per_team')
    await review.get('[data-testid="replication-reconcile-sources"]').trigger('click')
    const updated = wrapper.emitted('update:modelValue')[0][0]
    expect(updated.network_scopes).toEqual({ net1: 'per_team', net2: 'per_team' })
    for (const [key, assigned] of Object.entries(previous)) expect(updated.network_assignments[key]).toEqual(assigned)
    expect(Object.keys(updated.network_assignments)).toHaveLength(4)
    expect(wrapper.get('[data-testid="replication-counts"]').text()).toMatch(/3 VMs.*4 networks.*6 NICs/)
    wrapper.unmount()
  })

  it('does not rewrite surviving invalid scope values while reconciling source membership', async () => {
    const input = replicatedScenario()
    input.scenario.replication.node_scopes.vm1 = 'unknown_scope'
    input.scenario.replication.node_scopes.removed = 'shared'
    const wrapper = panel(input)
    await wrapper.get('[data-testid="replication-reconcile-sources"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')[0][0].node_scopes).toEqual({ vm1: 'unknown_scope' })
    expect(wrapper.get('[data-testid="replication-error"]').text()).toContain('Unsupported replication scope')
    expect(wrapper.find('[data-testid="replication-counts"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
