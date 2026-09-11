import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getScenarioAllocationProof, prepareReplicatedAllocation, applyReplicatedAllocation, applyScenarioAllocation, reserveScenarioAllocation, restoreScenarioAllocation, releaseScenarioAllocation } from '@/services/scenarioAllocation'

import { replicatedScenario, replicationKey } from './fixtures/replicatedScenario'
import { emitConcreteScenario } from '@/services/concreteScenario'

const { request, state } = vi.hoisted(() => ({ request: vi.fn(), state: { scope: 'https://backend.test' } }))
vi.mock('@/services/backendApi', () => ({ backendRequest: request, getBackendScope: () => state.scope }))
const rows = () => [
  { node_id: 'web', vm_name: 'Web', vm_id: '', nics: [{ network_id: 'blue', ip: '' }, { network_id: 'red', ip: '10.2.0.9' }] },
  { node_id: 'db', vm_id: 2500, template_vm_id: 9901, nics: [{ network_id: 'blue', ip: '10.1.0.8' }] },
]
const networks = [{ id: 'blue', vnet: 'blue', subnet: '10.1.0.0/24', gateway: '10.1.0.1' }, { id: 'red', vnet: 'red', subnet: '10.2.0.0/24', gateway: '10.2.0.1' }]
const reservation = () => ({ reservation_id: 'lease-1', project_key: 'project-1', host_id: 'pve-1', node_name: 'pve', expires_at: '2099-01-01T00:00:00Z', checked_at: '2026-09-10T00:00:00Z', limitations: [], assignments: [
  { node_id: 'web', vm_id: 2000, nics: [{ index: 0, network_id: 'blue', bridge: 'blue', subnet: '10.1.0.0/24', ip: '10.1.0.2', prefix: 24 }, { index: 1, network_id: 'red', bridge: 'red', subnet: '10.2.0.0/24', ip: '10.2.0.9', prefix: 24 }] },
  { node_id: 'db', vm_id: 2500, nics: [{ index: 0, network_id: 'blue', bridge: 'blue', subnet: '10.1.0.0/24', ip: '10.1.0.8', prefix: 24 }] },
] })
const input = () => ({ projectKey: 'project-1', targetHostId: 'pve-1', vms: rows(), networks, vmidStart: 2000, vmidEnd: 8999 })
beforeEach(() => { localStorage.clear(); request.mockReset().mockResolvedValue(reservation()); state.scope = 'https://backend.test' })

describe('durable scenario reservations', () => {
  it('requests manual choices unchanged and omits only empty assignments', async () => {
    await reserveScenarioAllocation(input())
    const [path, options] = request.mock.calls[0]
    expect(path).toBe('/v1/proxmox/hosts/pve-1/reservations')
    expect(options.headers['X-Range42-Reservation-Token']).toMatch(/^[\w-]{32,}$/)
    expect(JSON.parse(options.body)).toEqual({ project_key: 'project-1', vmid_start: 2000, vmid_end: 8999, networks: networks.map(n => ({ network_id: n.id, bridge: n.vnet, subnet: n.subnet, gateway: n.gateway })), vms: [
      { node_id: 'web', nics: [{ index: 0, network_id: 'blue' }, { index: 1, network_id: 'red', ip: '10.2.0.9' }] },
      { node_id: 'db', vm_id: 2500, nics: [{ index: 0, network_id: 'blue', ip: '10.1.0.8' }] },
    ] })
  })
  it('reuses ownership after an uncertain network outcome and restores the same lease after reopening', async () => {
    request.mockRejectedValueOnce(new Error('Connection lost'))
    await expect(reserveScenarioAllocation(input())).rejects.toThrow('Connection lost')
    await reserveScenarioAllocation(input())
    const firstToken = request.mock.calls[0][1].headers['X-Range42-Reservation-Token']
    expect(request.mock.calls[1][1].headers['X-Range42-Reservation-Token']).toBe(firstToken)
    expect(await restoreScenarioAllocation('project-1', 'pve-1')).toEqual(reservation())
    expect(request.mock.calls[2]).toEqual(['/v1/proxmox/hosts/pve-1/reservations/lease-1', { headers: { 'X-Range42-Reservation-Token': firstToken } }])
  })
  it('scopes ownership by backend, target and project', async () => {
    await reserveScenarioAllocation(input())
    state.scope = 'https://other.test'
    await reserveScenarioAllocation(input())
    request.mockResolvedValue({ ...reservation(), host_id: 'pve-2' })
    await reserveScenarioAllocation({ ...input(), targetHostId: 'pve-2' })
    request.mockResolvedValue({ ...reservation(), project_key: 'project-2' })
    await reserveScenarioAllocation({ ...input(), projectKey: 'project-2' })
    expect(new Set(request.mock.calls.map(([, options]) => options.headers['X-Range42-Reservation-Token'])).size).toBe(4)
  })
  it('does not restore another backend response after context changes during a request', async () => {
    request.mockImplementationOnce(async () => { state.scope = 'https://other.test'; return reservation() })
    await expect(reserveScenarioAllocation(input())).rejects.toThrow(/backend changed/i)
    expect(await restoreScenarioAllocation('project-1', 'pve-1')).toBeNull()
  })
  it('releases with the saved owner token and forgets a confirmed released lease', async () => {
    await reserveScenarioAllocation(input())
    request.mockResolvedValue(undefined)
    await releaseScenarioAllocation('project-1', 'pve-1', 'lease-1')
    expect(request.mock.calls[1][1].method).toBe('DELETE')
    expect(request.mock.calls[1][1].headers).toEqual(request.mock.calls[0][1].headers)
    expect(await restoreScenarioAllocation('project-1', 'pve-1')).toBeNull()
  })
  it('treats an already expired or released reservation as a successful release', async () => {
    await reserveScenarioAllocation(input())
    request.mockRejectedValueOnce(Object.assign(new Error('Lease already expired'), { code: 'ALLOCATION_EXPIRED' }))
    await expect(releaseScenarioAllocation('project-1', 'pve-1', 'lease-1')).resolves.toBeUndefined()
    expect(await restoreScenarioAllocation('project-1', 'pve-1')).toBeNull()
  })
  it.each([['vmidStart', 99], ['vmidEnd', 1000]])('rejects an invalid %s before reserving', async (key, value) => {
    await expect(reserveScenarioAllocation({ ...input(), [key]: value })).rejects.toThrow(/range/i)
    expect(request).not.toHaveBeenCalled()
  })
  it.each(['bad-id', 1.5, 99, 1000000000])('rejects an invalid manual ID %s instead of turning it into an automatic request', async vm_id => {
    const values = input()
    values.vms[0].vm_id = vm_id
    await expect(reserveScenarioAllocation(values)).rejects.toThrow(/manual VM ID/i)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('applying reviewed assignments', () => {
  it('returns a clone, fills missing fields and preserves manual values and VM settings', () => {
    const vms = rows()
    const applied = applyScenarioAllocation(vms, reservation().assignments)
    expect(vms[0].vm_id).toBe('')
    expect(applied[0]).toMatchObject({ vm_id: 2000, ip: '10.1.0.2', network_id: 'blue', nics: [{ ip: '10.1.0.2' }, { ip: '10.2.0.9' }] })
    expect(applied[1]).toMatchObject({ vm_id: 2500, template_vm_id: 9901, nics: [{ ip: '10.1.0.8' }] })
  })
  it.each([
    result => { result[1].vm_id = 2501 },
    result => { result[0].nics[1].ip = '10.2.0.10' },
    result => { result[0].nics[0].network_id = 'red' },
    result => { result.pop() },
    result => { result[0].nics.pop() },
    result => { result[0].vm_id = 2500 },
  ])('rejects a mapping that changes manual choices or no longer matches the draft', mutate => {
    const assignments = reservation().assignments
    mutate(assignments)
    expect(() => applyScenarioAllocation(rows(), assignments)).toThrow(/assignment|manual|duplicate|draft/i)
  })
})


describe('stable NIC reservation identity', () => {
  it('sends exact NIC keys while preserving indexes and manual addresses', async () => {
    const values = input()
    values.vms[0].nics.forEach((nic, index) => { nic.key = `nic-${index}` })
    await reserveScenarioAllocation(values)
    expect(JSON.parse(request.mock.calls[0][1].body).vms[0].nics).toEqual([
      { index: 0, nic_key: 'nic-0', network_id: 'blue' },
      { index: 1, nic_key: 'nic-1', network_id: 'red', ip: '10.2.0.9' },
    ])
  })
  it.each([['primary', undefined], ['same', 'same'], ['bad:key', 'second'], ['', 'second']])('rejects mixed, duplicate or invalid keys %j before acquiring ownership', async (first, second) => {
    const values = input()
    values.vms[0].nics[0].key = first
    values.vms[0].nics[1].key = second
    await expect(reserveScenarioAllocation(values)).rejects.toThrow(/NIC key/i)
    expect(request).not.toHaveBeenCalled()
    expect(localStorage.getItem('range42_scenario_reservation_owners')).toBeNull()
  })
  it('applies a reordered keyed response using its returned indexes and rejects old key/index pairings', () => {
    const vms = rows()
    vms[0].nics[0].key = 'primary'
    vms[0].nics[1].key = 'secondary'
    const assignments = reservation().assignments
    assignments[0].nics[0].nic_key = 'primary'
    assignments[0].nics[1].nic_key = 'secondary'
    assignments[0].nics.reverse()
    expect(applyScenarioAllocation(vms, assignments)[0].nics.map(nic => nic.ip)).toEqual(['10.1.0.2', '10.2.0.9'])
    assignments[0].nics[0].nic_key = 'primary'
    expect(() => applyScenarioAllocation(vms, assignments)).toThrow(/NIC assignment/i)
  })
  it('rejects a missing key instead of treating a legacy lease as current keyed assignments', () => {
    const vms = rows()
    vms[0].nics.forEach((nic, index) => { nic.key = `nic-${index}` })
    expect(() => applyScenarioAllocation(vms, reservation().assignments)).toThrow(/NIC assignment/i)
  })
})

function allocated(plan) {
  return plan.vms.map((vm, vmIndex) => ({ node_id: vm.node_id, vm_id: vm.vm_id || 3401 + vmIndex,
    nics: vm.nics.map((nic, index) => {
      const network = plan.networks.find(network => network.id === nic.network_id)
      return { index, nic_key: nic.key, network_id: nic.network_id, bridge: network.vnet, subnet: network.subnet,
        ip: nic.ip || network.gateway.replace(/1$/, String(20 + vmIndex)), prefix: 24, gateway: network.gateway }
    }),
  }))
}

describe('literal replication reservations', () => {
  it('plans every user VM against its own team subnet and maps reserved values back without expanding authoring', async () => {
    const fixture = replicatedScenario()
    fixture.scenario.replication.vm_assignments = { retired: { vm_id: 3999, nics: {} } }
    const before = JSON.stringify(fixture)
    const plan = prepareReplicatedAllocation(fixture)
    expect(plan.vms).toHaveLength(3)
    expect(plan.networks).toHaveLength(2)
    expect(plan.vms.every(vm => vm.nics[0].key === 'nic-primary' && vm.vm_id === '')).toBe(true)
    request.mockResolvedValue({ ...reservation(), assignments: allocated(plan) })
    await reserveScenarioAllocation({ ...input(), vms: plan.vms, networks: plan.networks })
    const payload = JSON.parse(request.mock.calls[0][1].body)
    expect(payload.vms).toHaveLength(3)
    expect(payload.vms.every(vm => vm.node_id.startsWith('vm-') && vm.nics[0].nic_key === 'nic-primary')).toBe(true)
    expect(payload.vms[0].nics[0].network_id).toBe(replicationKey('net', 'net1', 'blue'))
    expect(payload.vms[2].nics[0].network_id).toBe(replicationKey('net', 'net1', 'red'))
    const applied = applyReplicatedAllocation(fixture, allocated(plan))
    expect(applied.vms).toEqual(fixture.scenario.vms)
    expect(applied.replication.teams).toEqual(fixture.scenario.replication.teams)
    expect(applied.replication.network_assignments).toEqual(fixture.scenario.replication.network_assignments)
    expect(applied.replication.vm_assignments.retired).toEqual({ vm_id: 3999, nics: {} })
    expect(applied.replication.vm_assignments[plan.vms[0].node_id]).toEqual({ vm_id: 3401, nics: { 'nic-primary': { ip: '10.42.10.20' } } })
    expect(JSON.stringify(fixture)).toBe(before)
    const compiled = emitConcreteScenario({ ...fixture, scenario: { ...fixture.scenario, ...applied } })
    expect(compiled.scenario.vms).toHaveLength(1)
    expect(JSON.parse(compiled.files['scenarios/replicated/manifest/scenario_vms.json']).vms.map(vm => vm.vm_id)).toEqual([3401, 3402, 3403])
  })
  it('updates a shared source VM by NIC identity and retains its source network IDs', () => {
    const fixture = replicatedScenario()
    fixture.scenario.replication.node_scopes.vm1 = 'shared'
    fixture.scenario.replication.network_scopes.net1 = 'shared'
    fixture.scenario.vms[0].vm_id = ''
    fixture.scenario.vms[0].nics[0].ip = ''
    const plan = prepareReplicatedAllocation(fixture)
    const applied = applyReplicatedAllocation(fixture, allocated(plan))
    expect(applied.vms[0]).toMatchObject({ node_id: 'vm1', vm_id: 3401, network_id: 'net1', ip: '10.42.9.20',
      nics: [{ key: 'nic-primary', network_id: 'net1', ip: '10.42.9.20' }] })
    expect(applied.replication.vm_assignments[plan.vms[0].node_id]).toEqual({ vm_id: 3401, nics: { 'nic-primary': { ip: '10.42.9.20' } } })
  })
  it('rejects an address newly excluded from a shared subnet before applying the saved mapping', () => {
    const fixture = replicatedScenario()
    fixture.scenario.replication.node_scopes.vm1 = 'shared'
    fixture.scenario.replication.network_scopes.net1 = 'shared'
    const assignments = allocated(prepareReplicatedAllocation(fixture))
    fixture.scenario.networks[0].reserved_ips = [assignments[0].nics[0].ip]
    const before = JSON.stringify(fixture)
    expect(() => applyReplicatedAllocation(fixture, assignments)).toThrow(/excluded|reserved address/i)
    expect(JSON.stringify(fixture)).toBe(before)
  })
  it('requires explicit network assignments before making an allocation plan', () => {
    const fixture = replicatedScenario()
    fixture.scenario.replication.network_assignments = {}
    expect(() => prepareReplicatedAllocation(fixture)).toThrow(/subnet|gateway/i)
  })
  it('rejects roster, network and manual assignment changes without mutating the draft', () => {
    for (const mutate of [
      fixture => { fixture.scenario.replication.teams.pop() },
      fixture => { Object.values(fixture.scenario.replication.network_assignments)[0].subnet = '10.99.0.0/24' },
      fixture => { Object.values(fixture.scenario.replication.vm_assignments)[0].vm_id = 3999 },
    ]) {
      const fixture = replicatedScenario()
      const assignments = allocated(prepareReplicatedAllocation(fixture))
      mutate(fixture)
      const before = JSON.stringify(fixture)
      expect(() => applyReplicatedAllocation(fixture, assignments)).toThrow(/assignment|draft|manual/i)
      expect(JSON.stringify(fixture)).toBe(before)
    }
  })
})


describe('deployment reservation ownership proof', () => {
  const proofInput = () => ({ localProjectId: 'project-1', targetHostId: 'pve-1',
    allocation: { backend_url: state.scope, target_host_id: 'pve-1', reservation: reservation() } })

  it('returns only the current lease id and private header without changing saved ownership', async () => {
    await reserveScenarioAllocation(input())
    const stored = localStorage.getItem('range42_scenario_reservation_owners')
    const token = request.mock.calls[0][1].headers['X-Range42-Reservation-Token']
    request.mockClear()
    expect(getScenarioAllocationProof(proofInput())).toEqual({ reservationId: 'lease-1',
      headers: { 'X-Range42-Reservation-Token': token } })
    expect(request).not.toHaveBeenCalled()
    expect(localStorage.getItem('range42_scenario_reservation_owners')).toBe(stored)
  })

  it('allows a manual deployment only when allocation metadata is absent', () => {
    expect(getScenarioAllocationProof({ localProjectId: 'project-1', targetHostId: 'pve-1', allocation: null })).toBeNull()
    expect(() => getScenarioAllocationProof({ ...proofInput(), allocation: {} })).toThrow(/reservation|backend/i)
  })

  it.each([
    ['backend', value => { value.allocation.backend_url = 'https://other.test' }],
    ['host', value => { value.targetHostId = 'pve-2' }],
    ['reservation host', value => { value.allocation.reservation.host_id = 'pve-2' }],
    ['project', value => { value.localProjectId = 'backend-project-1' }],
    ['missing project', value => { value.localProjectId = '' }],
    ['reservation id', value => { value.allocation.reservation.reservation_id = 'lease-2' }],
    ['expired', value => { value.allocation.reservation.expires_at = '2000-01-01T00:00:00Z' }],
    ['invalid expiry', value => { value.allocation.reservation.expires_at = 'not-a-date' }],
  ])('rejects %s mismatch and preserves the original owner', async (_label, mutate) => {
    await reserveScenarioAllocation(input())
    const stored = localStorage.getItem('range42_scenario_reservation_owners')
    const value = proofInput()
    mutate(value)
    expect(() => getScenarioAllocationProof(value)).toThrow(/reserv|project|backend|expir|host|target/i)
    expect(localStorage.getItem('range42_scenario_reservation_owners')).toBe(stored)
  })

  it.each([null, 'x'.repeat(31), 'x'.repeat(129), { fake: 'x'.repeat(64) }])('rejects missing or malformed private ownership %j', async token => {
    await reserveScenarioAllocation(input())
    const key = 'range42_scenario_reservation_owners'
    if (token === null) localStorage.removeItem(key)
    else {
      const stored = JSON.parse(localStorage.getItem(key))
      Object.values(stored)[0].token = token
      localStorage.setItem(key, JSON.stringify(stored))
    }
    expect(() => getScenarioAllocationProof(proofInput())).toThrow(/own|browser/i)
  })
})
