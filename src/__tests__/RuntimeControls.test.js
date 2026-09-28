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
  it('explains how to prepare new networks for later cleanup', async () => {
    state.permissions = { admin: true, operate: true }
    state.runtime.operations.push('sdn_network')
    state.networks[0].identity_matches = false
    const wrapper = await show()
    expect(wrapper.get('[data-testid="runtime-network-preparation"]').text()).toContain('before starting the guests')
    expect(wrapper.get('[data-testid="runtime-network-create-lab1"]').attributes('disabled')).toBeUndefined()
  })
  it('preserves a policy draft and blocks editing if the refreshed report is unavailable', async () => {
    state.permissions = { admin: true, operate: true }
    state.runtime.operations.push('firewall_rule', 'firewall_alias')
    let failReport = false
    fetchMock.mockImplementation(url => {
      if (url.endsWith('/runtime-report') && failReport) return Promise.resolve(new Response(JSON.stringify({ message: 'Report unavailable' }), { status: 503 }))
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/runtime-report')
        ? { version: 1, chains: [{ scope: 'vm', vm_id: 3191, available: true, aliases: [], rules: [] }],
          cards: [], live_nat: { available: false, rules: [] } } : state)))
    })
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-report-open"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="policy-port"]').setValue('8443')
    failReport = true
    await wrapper.get('header button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="runtime-report"] [role="alert"]').text()).toContain('Report unavailable')
    expect(wrapper.get('[data-testid="policy-port"]').element.value).toBe('8443')
    expect(wrapper.get('[data-testid="policy-port"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="policy-rule-form"]').trigger('submit')
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
  it.each(['operation completion', 'manual refresh'])('refreshes the open report after %s without losing a policy draft', async trigger => {
    state.permissions = { admin: true, operate: true }
    state.runtime.operations.push('firewall_rule', 'firewall_alias')
    let observedPort = '443'
    fetchMock.mockImplementation(url => Promise.resolve(new Response(JSON.stringify(url.endsWith('/runtime-report')
      ? { version: 1, chains: [{ scope: 'vm', vm_id: 3191, available: true, aliases: [], rules: [{ position: 0,
        direction: 'in', action: 'ACCEPT', protocol: 'tcp', destination_port: observedPort, enabled: true,
        comment: 'range42-deployment:dep;rule:web' }] }], cards: [], live_nat: { available: false, rules: [] } }
      : state))))
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-report-open"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="policy-edit-vm-3191-0"]').trigger('click')
    await wrapper.get('[data-testid="policy-port"]').setValue('8443')
    observedPort = '9443'
    if (trigger === 'operation completion') {
      await wrapper.setProps({ disabled: true })
      await wrapper.setProps({ disabled: false })
    } else {
      await wrapper.get('header button').trigger('click')
    }
    await flushPromises()
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/runtime-report'))).toHaveLength(2)
    expect(wrapper.get('[data-testid="runtime-report"]').text()).toContain('9443')
    expect(wrapper.get('[data-testid="policy-port"]').element.value).toBe('8443')
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
  it('reviews exact VNet lifecycle scope and submits only the server-reviewed identity', async () => {
    state.permissions = { admin: true, operate: true }
    state.runtime.operations.push('sdn_network')
    fetchMock.mockImplementation((url, init) => Promise.resolve(new Response(JSON.stringify(url.endsWith('/operations/plan')
      ? { review_fingerprint: 'c'.repeat(64), target_host_id: 'host1', target_identity: { node_name: 'pve01' }, project_sha: 'b'.repeat(40),
        plan: { network: { zone: 'r42lab', vnet: 'lab1', subnet: '10.42.1.0/24', gateway: '10.42.1.1' }, preserve_zone: true } }
      : init?.method === 'POST' ? { id: 'attempt-network', state: 'pending' } : state))))
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-network-delete-lab1"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('form').text()).toContain('r42lab')
    expect(wrapper.get('form').text()).toContain('10.42.1.1')
    expect(wrapper.get('form').text()).toContain('shared zone')
    await wrapper.get('[data-testid="runtime-shared-ack"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/operations'))[1].body)).toEqual({
      kind: 'sdn_network', action: 'delete', vnet: 'lab1', acknowledge_shared_scope: true, review_fingerprint: 'c'.repeat(64),
    })
  })
  it('binds administrator host changes to a server preview and shared-scope acknowledgement', async () => {
    state.permissions = { admin: true, operate: true }
    state.runtime.operations.push('host_firewall')
    fetchMock.mockImplementation((url, init) => Promise.resolve(new Response(JSON.stringify(url.endsWith('/operations/plan')
      ? { review_fingerprint: 'a'.repeat(64), target_host_id: 'host1', target_identity: { node_name: 'pve01' }, project_sha: 'b'.repeat(40),
        plan: { before: { datacenter_enabled: true, node_enabled: false }, shared_scope: 'datacenter_and_selected_node' } }
      : init?.method === 'POST' ? { id: 'attempt-runtime', state: 'pending' } : state))))
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-host-enable"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('8006')
    expect(wrapper.text()).toContain('host1')
    expect(wrapper.get('[data-testid="runtime-apply"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="runtime-shared-ack"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/operations'))[1].body)).toEqual({
      kind: 'host_firewall', enabled: true, acknowledge_shared_scope: true, review_fingerprint: 'a'.repeat(64),
    })
  })
  it('keeps host administration unavailable to operators even if the runtime supports it', async () => {
    state.permissions = { admin: false, operate: true }
    state.runtime.operations.push('host_firewall')
    const wrapper = await show()
    expect(wrapper.find('[data-testid="runtime-host-enable"]').exists()).toBe(false)
  })
  it('does not accept a preview returned after switching backend', async () => {
    state.permissions = { admin: true, operate: true }
    state.runtime.operations.push('host_firewall')
    let finish
    fetchMock.mockImplementation(url => url.endsWith('/operations/plan') ? new Promise(resolve => { finish = resolve })
      : Promise.resolve(new Response(JSON.stringify(state))))
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-host-enable"]').trigger('click')
    await flushPromises()
    const backend = useBackendApiStore()
    backend.setActiveHost(backend.addHost({ url: 'https://other.test' }))
    await flushPromises()
    finish(new Response(JSON.stringify({ review_fingerprint: 'a'.repeat(64), plan: {} })))
    await flushPromises()
    expect(wrapper.find('[data-testid="runtime-apply"]').exists()).toBe(false)
  })
  it('opens a read-only detailed report without sending a mutation', async () => {
    const wrapper = await show()
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      version: 1, observed_at: '2026-09-22T10:00:00Z', partial: true, traffic_verified: false,
      chains: [{ scope: 'datacenter', available: false, error: 'Permission missing', rules: [], aliases: [] }], cards: [],
      live_nat: { available: false, rules: [] },
      switches: { datacenter_enabled: true, node_enabled: null }, sdn: { pending_changes: null, errors: [] },
      networks: [{ vnet: 'r42blue', zone: 'r42lab', subnet: '10.42.70.0/24', gateway: '10.42.70.1',
        active: null, identity_matches: null, manifest_snat: true, configured_snat: null }],
    }))))
    await wrapper.get('[data-testid="runtime-report-open"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Permission missing')
    expect(wrapper.text()).toContain('Traffic has not been tested')
    expect(wrapper.get('[data-testid="reported-network-r42blue"]').text()).toContain('10.42.70.0/24')
    expect(wrapper.get('[data-testid="reported-network-r42blue"]').text()).toContain('Unknown')
    expect(fetchMock.mock.calls.at(-1)[0]).toContain('/runtime-report')
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
  it('routes a policy edit through administrator review and preserves its exact source restriction', async () => {
    state.permissions = { admin: true, operate: true }
    state.runtime.operations.push('firewall_rule', 'firewall_alias')
    fetchMock.mockImplementation((url, init) => Promise.resolve(new Response(JSON.stringify(url.endsWith('/runtime-report')
      ? { version: 1, chains: [{ scope: 'vm', vm_id: 3191, available: true, aliases: [], rules: [{ position: 0,
        direction: 'in', action: 'ACCEPT', protocol: 'tcp', destination_port: '443', source: '10.42.70.0/24', enabled: true,
        comment: 'range42-deployment:dep;rule:web' }] }], cards: [], live_nat: { available: false, rules: [] } }
      : url.endsWith('/operations/plan') ? { review_fingerprint: 'd'.repeat(64), target_host_id: 'host1', target_identity: { node_name: 'pve01' },
        plan: { scope: 'vm' } } : init?.method === 'POST' ? { id: 'policy-attempt', state: 'pending' } : state))))
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-report-open"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="policy-edit-vm-3191-0"]').trigger('click')
    await wrapper.get('[data-testid="policy-port"]').setValue('8443')
    await wrapper.get('[data-testid="policy-rule-form"]').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="runtime-apply"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="runtime-shared-ack"]').setValue(true)
    await wrapper.get('[data-testid="runtime-apply"]').trigger('submit')
    await flushPromises()
    const body = JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/operations'))[1].body)
    expect(body).toMatchObject({ kind: 'firewall_rule', scope: 'vm', vm_id: 3191, action: 'update', position: 0,
      review_fingerprint: 'd'.repeat(64), rule: { source: '10.42.70.0/24', destination_port: '8443' } })
  })
  it('describes the native NAT operation as preserving other subnets prior live state', async () => {
    state.runtime.contract = 'native-sdn-20260921'
    const wrapper = await show()
    await wrapper.get('[data-testid="runtime-nat-lab1"]').trigger('click')
    expect(wrapper.text()).toContain('prior live SNAT state')
  })
  it('shows a useful error and no actions for an incomplete runtime response', async () => {
    state.firewall = {}
    const wrapper = await show()
    expect(wrapper.get('[role="alert"]').text()).toBe(runtime.invalidState)
    expect(wrapper.find('[data-testid="runtime-scenario-enable"]').exists()).toBe(false)
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
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
