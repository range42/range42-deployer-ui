import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ScenarioReplicationPanel from '@/components/project/ScenarioReplicationPanel.vue'
import { planScenarioReplication } from '@/services/scenarioReplication'
import { captureProjectAuthoring } from '@/services/projectAuthoring'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { replicatedScenario, replicationKey } from './fixtures/replicatedScenario'

const blue = replicationKey('net', 'net1', 'blue')

describe('explicit subnet address exclusions', () => {
  it('takes scoped exclusions only from that instance and preserves shared source exclusions', () => {
    const input = replicatedScenario()
    input.scenario.networks[0].reserved_ips = ['10.42.9.50']
    input.scenario.replication.network_assignments[blue].reserved_ips = ['10.42.10.50']
    const plan = planScenarioReplication(input)
    expect(plan.networks.map(network => network.reserved_ips || [])).toEqual([['10.42.10.50'], []])
    input.scenario.replication.network_scopes.net1 = 'shared'
    expect(planScenarioReplication(input).networks[0].reserved_ips).toEqual(['10.42.9.50'])
  })

  it('persists explicit exclusions for both source and instance networks', () => {
    const input = replicatedScenario()
    input.scenario.networks[0].reserved_ips = ['10.42.9.50']
    input.scenario.replication.network_assignments[blue].reserved_ips = ['10.42.10.50']
    const saved = captureProjectAuthoring('course-1', input)
    expect(saved.scenario.networks[0].reserved_ips).toEqual(['10.42.9.50'])
    expect(saved.scenario.replication.network_assignments[blue].reserved_ips).toEqual(['10.42.10.50'])
    expect(planScenarioReplication({ ...input, scenario: saved.scenario }).networks[0].reserved_ips).toEqual(['10.42.10.50'])
  })

  it.each([[{ token: 'private-value' }], Array(257).fill('10.42.10.50'), '10.42.10.50'].map(value => [value]))('rejects malformed exclusion lists before saving', value => {
    const input = replicatedScenario()
    input.scenario.replication.network_assignments[blue].reserved_ips = value
    expect(() => captureProjectAuthoring('course-1', input)).toThrow(/reserved.*IP/i)
  })

  it.each(['10.42.10.11', '10.42.9.50'])('refuses deployment with a reserved VM address or an exclusion outside its subnet: %s', value => {
    const input = replicatedScenario()
    input.scenario.replication.network_assignments[blue].reserved_ips = [value]
    expect(() => emitConcreteScenario(input)).toThrow(/reserved.*address|reserved.*subnet/i)
  })

  it('authors exclusions for one network without changing the source or another instance', async () => {
    const input = replicatedScenario()
    const wrapper = mount(ScenarioReplicationPanel, { props: {
      modelValue: input.scenario.replication, scenario: input.scenario, projectId: 'course-1', nodes: input.nodes, edges: input.edges,
    } })
    await wrapper.get('[data-testid="replication-reserved-ips"]').setValue('10.42.10.50, 10.42.10.51')
    const changed = wrapper.emitted('update:modelValue')[0][0]
    expect(changed.network_assignments[blue].reserved_ips).toEqual(['10.42.10.50', '10.42.10.51'])
    expect(changed.network_assignments[replicationKey('net', 'net1', 'red')]).toEqual(input.scenario.replication.network_assignments[replicationKey('net', 'net1', 'red')])
    expect(input.scenario.replication.network_assignments[blue].reserved_ips).toBeUndefined()
    wrapper.unmount()
  })
})
