import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import RuntimeControls from '@/components/deployment/RuntimeControls.vue'
import runtime from '@/locales/en/runtime.json'
import { useBackendApiStore } from '@/stores/backendApiStore'

vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))
enableAutoUnmount(afterEach)
let state
let fetchMock
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useBackendApiStore().addHost({ url: 'https://backend.test', token: 'operator-token' })
  state = {
    node_name: 'pve01', firewall: { datacenter_enabled: true, node_enabled: false, errors: [] },
    vms: [{ vm_id: 3191, name: 'guest-one', status: 'owned', firewall_enabled: false,
      nics: [{ index: 0, bridge: 'lab1', firewall_enabled: false }], filtering_configured: false }],
    networks: [{ vnet: 'lab1', zone: 'r42lab', subnet: '10.42.1.0/24', gateway: '10.42.1.1',
      manifest_snat: true, configured_snat: true, identity_matches: true, active: true, live_forwarding_verified: false }],
    sdn: { pending_changes: false, errors: [] }, runtime: { available: true, operations: ['vm_firewall', 'scenario_firewall', 'sdn_snat'] },
  }
  fetchMock = vi.fn().mockImplementation((_url, init) => Promise.resolve(new Response(JSON.stringify(init?.method === 'POST' ? { id: 'attempt-runtime', scope: 'runtime', state: 'pending' } : state))))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
async function show(props = {}) {
  const wrapper = mount(RuntimeControls, { props: { deploymentId: 'dep', ...props }, global: {
    plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { runtime } } })],
  } })
  await flushPromises()
  return wrapper
}

describe('live network and firewall controls', () => {
  it('shows datacenter, node, VM and NIC states independently', async () => {
    const wrapper = await show()
    expect(wrapper.text()).toContain('Datacenter: Enabled')
    expect(wrapper.text()).toContain('Node pve01: Disabled')
    expect(wrapper.text()).toContain('net0 · lab1 · Disabled')
    expect(wrapper.text()).toContain('Forwarding has not been tested')
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
  it('reviews an explicit owned-VM operation before submitting it with authentication', async () => {
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-vm-3191"]').trigger('click')
    expect(fetchMock.mock.calls).toHaveLength(1)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const [url, init] = fetchMock.mock.calls.find(([, init]) => init.method === 'POST')
    expect(url).toBe('https://backend.test/v1/deployments/dep/operations')
    expect(JSON.parse(init.body)).toEqual({ kind: 'vm_firewall', vm_id: 3191, enabled: true })
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer operator-token')
    expect(wrapper.emitted('started')[0][0].id).toBe('attempt-runtime')
  })
  it('requires acknowledging shared SDN scope before changing live NAT', async () => {
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-nat-lab1"]').trigger('click')
    expect(wrapper.get('[data-testid="runtime-apply"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="runtime-shared-ack"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const [, init] = fetchMock.mock.calls.find(([, init]) => init.method === 'POST')
    expect(JSON.parse(init.body)).toEqual({ kind: 'sdn_snat', vnet: 'lab1', enabled: false, acknowledge_shared_scope: true })
  })
  it.each(['conflict', 'unavailable', 'missing'])('does not offer mutations for a %s guest', async status => {
    state.vms[0].status = status
    const wrapper = await show()
    expect(wrapper.get('[data-testid="runtime-vm-3191"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="runtime-scenario-enable"]').attributes('disabled')).toBeDefined()
  })
  it('blocks NAT mutations while unrelated SDN changes are pending', async () => {
    state.sdn.pending_changes = true
    const wrapper = await show()
    expect(wrapper.get('[data-testid="runtime-nat-lab1"]').attributes('disabled')).toBeDefined()
  })
  it('clears reviewed actions when the backend changes', async () => {
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-vm-3191"]').trigger('click')
    const backend = useBackendApiStore()
    backend.setActiveHost(backend.addHost({ url: 'https://other.test' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="runtime-apply"]').exists()).toBe(false)
    expect(fetchMock.mock.calls.at(-1)[0]).toBe('https://other.test/v1/deployments/dep/runtime')
  })
})
