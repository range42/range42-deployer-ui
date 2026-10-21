import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import NativeDeploymentFields from '@/components/project/NativeDeploymentFields.vue'
import deployment from '@/locales/en/deployment.json'
import { getScenarioAllocationProof } from '@/services/scenarioAllocation'

enableAutoUnmount(afterEach)
const calls = vi.hoisted(() => ({ requests: [] as Array<{url: string; body: Record<string, unknown>; headers: unknown}>, reject: false, registered: true }))
vi.mock('@/services/backendApi', () => ({getBackendScope: () => 'foundation-fixture', backendRequest: async (url: string, options?: RequestInit) => {
  if (url === '/v1/contexts') return {items: [{id: calls.registered ? 'env-'+'a'.repeat(24) : 'node2', label: 'Workshop node', target_host_id: 'h', ready: true,
    issues: [], purpose: 'workshop', execution_ready: false, workshop_profile: {id: 'isolated', proxmox_template: 9240, deployer_template: 9241, storage: 'ceph-range',
      managed_gateway: {management_bridge: 'vmbr550', management_subnet: '10.78.255.0/29'}}}]}
  if (url.includes('/foundation/')) {
    const body = JSON.parse(String(options?.body)); calls.requests.push({url, body, headers: options?.headers})
    if (calls.reject) throw new Error('Original template copy VMID is already allocated')
    if (url.endsWith('/reservations')) return {project_key: body.project_key, host_id: 'h', node_name: 'node2',
      reservation_id: 'foundation-lease', expires_at: new Date(Date.now()+3600000).toISOString(), assignments: [], limitations: []}
    return {topology: {vms: [{vm_id: 9240}, {vm_id: 9241}], templates: [{vm_id: 9230}, {vm_id: 9222}],
      networks: [], warnings: [], reservations: {status: 'missing', issues: []}},
      capacity: {memory_mib: 20480, vcpus: 6, logical_bytes: 206166818816}}
  }
  return {features: [], topology: {vms: [], templates: [], networks: [], warnings: [], reservations: {status: 'missing', issues: []}},
    preparation: {version: 1, kind: 'native-workshop-foundation', title: 'Reusable workshop templates'}}
}}))

async function mounted() {
  const view = mount(NativeDeploymentFields, {props: {projectId: 'p', revision: 'a'.repeat(40), path: 'scenarios/my-foundation'},
    global: {plugins: [createPinia(), createI18n({legacy: false, locale: 'en', messages: {en: {deployment}}})]}})
  await flushPromises()
  return view
}

it('prepares reusable copies through the ordinary native deployment form and same private lease handoff', async () => {
  calls.requests = []; localStorage.clear()
  const view = await mounted()
  expect(view.find('[data-testid="foundation-setup"]').exists()).toBe(true)
  expect(view.find('[data-testid="independent-workshop-setup"]').exists()).toBe(false)
  expect(view.emitted('select')?.at(-1)).toEqual([null])
  for (const [name, value] of Object.entries({namespace: 'workshop-base', source_node: 'node1', proxmox_source: 9230, deployer_source: 9222})) {
    await view.get(`[data-testid="foundation-input-${name}"]`).setValue(value)
  }
  await view.get('[data-testid="foundation-review-plan"]').trigger('click'); await flushPromises()
  expect(calls.requests.map(item => item.url)).toEqual(['/v1/projects/p/native-scenario/foundation/preview', '/v1/projects/p/native-scenario/foundation/reservations'])
  const choice = view.emitted('select')?.at(-1)?.[0] as {context_id: string; foundation: unknown; allocation: {reservation: {project_key: string}}}
  expect(choice).toMatchObject({context_id: 'env-'+'a'.repeat(24), foundation: {source_node: 'node1', proxmox_source: 9230, deployer_source: 9222}})
  expect(choice).not.toHaveProperty('prepare_environment_networks')
  expect(choice).not.toHaveProperty('workshop')
  expect(calls.requests[1]?.body).not.toHaveProperty('vmid_start')
  const proof = getScenarioAllocationProof({allocation: choice.allocation,
    localProjectId: choice.allocation.reservation.project_key, targetHostId: 'h'})
  expect(proof?.reservationId).toBe('foundation-lease')
  expect(proof?.headers).toEqual(calls.requests[1]?.headers)
  expect(view.text()).toContain('20 GiB')
  await view.get('[data-testid="foundation-input-source_node"]').setValue('other-node')
  expect(view.emitted('select')?.at(-1)).toEqual([null])
})

it('offers optional registered environment bridges in the ordinary foundation form', async () => {
  calls.requests = []
  const view = await mounted()
  const option = view.get('[data-testid="foundation-prepare-networks"]')
  expect((option.element as HTMLInputElement).checked).toBe(false)
  await option.setValue(true)
  for (const [name, value] of Object.entries({namespace: 'workshop-base', source_node: 'node1', proxmox_source: 9230, deployer_source: 9222})) {
    await view.get(`[data-testid="foundation-input-${name}"]`).setValue(value)
  }
  await view.get('[data-testid="foundation-review-plan"]').trigger('click'); await flushPromises()
  expect(view.emitted('select')?.at(-1)?.[0]).toMatchObject({prepare_environment_networks: true})
  expect(calls.requests).toHaveLength(2)
  expect(calls.requests.every(call => !('prepare_environment_networks' in (call.body.foundation as Record<string, unknown>)))).toBe(true)
  await option.setValue(false)
  expect(view.emitted('select')?.at(-1)).toEqual([null])
})

it('keeps bridge preparation unavailable for a static runtime context', async () => {
  calls.registered = false
  try {
    const view = await mounted()
    expect((view.get('[data-testid="foundation-prepare-networks"]').element as HTMLInputElement).disabled).toBe(true)
    expect(view.text()).toContain('registered environment')
  } finally { calls.registered = true }
})

it('preserves a failed foundation review and never falls back to the general protected-VM allocator', async () => {
  calls.reject = true; calls.requests = []
  try {
    const view = await mounted()
    for (const [name, value] of Object.entries({namespace: 'workshop-base', source_node: 'node1', proxmox_source: 9230, deployer_source: 9222})) {
      await view.get(`[data-testid="foundation-input-${name}"]`).setValue(value)
    }
    await view.get('[data-testid="foundation-review-plan"]').trigger('click'); await flushPromises()
    expect(view.text()).toContain('already allocated')
    expect(view.emitted('select')?.at(-1)).toEqual([null])
    expect(calls.requests).toHaveLength(1)
  } finally { calls.reject = false }
})
