import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import NativeDeploymentFields from '@/components/project/NativeDeploymentFields.vue'
import deployment from '@/locales/en/deployment.json'

enableAutoUnmount(afterEach)
const calls = vi.hoisted(() => ({ preview: vi.fn(), reserve: vi.fn(), rejectReservation: false, hasProfile: true }))
vi.mock('@/services/backendApi', () => ({ getBackendScope: () => 'fixture', backendRequest: async (url: string, options?: RequestInit) => {
  if (url === '/v1/proxmox/hosts/host/reservations') {
    const request = JSON.parse(String(options?.body)); calls.reserve(request)
    if (calls.rejectReservation) throw new Error('VMID is already occupied')
    return {project_key: request.project_key, host_id: 'host', reservation_id: 'lease', expires_at: new Date(Date.now() + 3600000).toISOString(), assignments: []}
  }
  if (url === '/v1/contexts') return { items: [{ id: 'pve', target_host_id: 'host', ready: true, issues: [], workshop_profile: calls.hasProfile ? {id: 'approved-workshops'} : null }] }
  if (url.endsWith('/native-scenario/preview')) {
    const request = JSON.parse(String(options?.body)); calls.preview(request)
    return {allocation_request: {vmid_start: request.workshop.vmid_start, vmid_end: request.workshop.vmid_start + 9, networks: [{network_id: 'vmbr600', bridge: 'vmbr600', subnet: '10.79.0.0/28'}], vms: [{node_id: 'user01-proxmox', vm_id: request.workshop.vmid_start, nics: [{index: 0, network_id: 'vmbr600', ip: '10.79.0.2'}]}]}, preview_only: true, resources_reserved: false, capacity: {memory_mib: 102400, vcpus: 30, disk_gib: 960},
      assignments: [], topology: { vms: [{vm_id: request.workshop.vmid_start, vm_name: 'owned-pve', bridge: 'vmbr600'}], templates: [], networks: [], warnings: [], reservations: {status: 'checked', issues: []} } }
  }
  return { features: [], topology: {vms: [], templates: [], networks: [], warnings: [], reservations: {status: 'missing', issues: []}},
    workshop: {version: 1, kind: 'native-installation', title: 'Install Range42', min_seats: 1, max_seats: 10} }
} }))

it('provides human run setup at any catalog path and submits the reviewed plan inputs', async () => {
  const view = mount(NativeDeploymentFields, { props: {projectId: 'project', revision: 'a'.repeat(40), path: 'scenarios/installer-course'},
    global: {plugins: [createPinia(), createI18n({legacy: false, locale: 'en', messages: {en: {deployment}}})]} })
  await flushPromises()
  expect(view.find('[data-testid="independent-workshop-setup"]').exists()).toBe(true)
  expect(view.emitted('select')?.at(-1)).toEqual([null])
  for (const [name, value] of Object.entries({namespace: 'training-b', seats: '5', expires_at: '2030-10-23T18:00', vmid_start: '46000',
    network_pool: '10.79.0.0/24', bridge_start: '600', proxmox_template: '9230', deployer_template: '9222', storage: 'ceph-range'})) {
    await view.get(`[data-testid="workshop-input-${name}"]`).setValue(value)
  }
  await view.get('[data-testid="workshop-review-plan"]').trigger('click'); await flushPromises()
  expect(calls.preview).toHaveBeenLastCalledWith(expect.objectContaining({sha: 'a'.repeat(40), path: 'scenarios/installer-course',
    workshop: expect.objectContaining({namespace: 'training-b', seats: 5, vmid_start: 46000, bridge_start: 600})}))
  expect(calls.reserve).toHaveBeenLastCalledWith(expect.objectContaining({vmid_start: 46000}))
  expect(view.get('[data-testid="native-resource-summary"]').text()).toContain('1 VMs')
  expect(view.emitted('select')?.at(-1)?.[0]).toMatchObject({context_id: 'pve', allocation: {backend_url: 'fixture', target_host_id: 'host', reservation: {reservation_id: 'lease'}}, workshop: {namespace: 'training-b', seats: 5, vmid_start: 46000}})
  await view.get('[data-testid="workshop-input-seats"]').setValue('6')
  expect(view.emitted('select')?.at(-1)).toEqual([null])
  expect(view.text()).toContain('Review the updated resource plan')
  expect(view.find('[data-testid="workshop-accept-NETWORK"]').exists()).toBe(false)
  calls.rejectReservation = true
  await view.get('[data-testid="workshop-review-plan"]').trigger('click'); await flushPromises()
  expect(view.emitted('select')?.at(-1)).toEqual([null])
  expect(view.text()).toContain('VMID is already occupied')
  calls.rejectReservation = false
})


it('blocks workshop authoring on a normal context without an approved provisioning profile', async () => {
  calls.hasProfile = false
  try {
    const view = mount(NativeDeploymentFields, {props: {projectId: 'project', revision: 'a'.repeat(40), path: 'scenarios/installer-course'},
      global: {plugins: [createPinia(), createI18n({legacy: false, locale: 'en', messages: {en: {deployment}}})]}})
    await flushPromises()
    expect(view.text()).toContain('Workshop provisioning profile is not configured')
    expect(view.emitted('select')?.at(-1)).toEqual([null])
    expect(view.get('[data-testid="workshop-review-plan"]').attributes('disabled')).toBeDefined()
  } finally { calls.hasProfile = true }
})
