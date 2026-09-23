import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RegisteredTargetsPanel from '@/components/settings/RegisteredTargetsPanel.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'

let backend: ReturnType<typeof useBackendApiStore>
let wrapper: ReturnType<typeof mount>
const target = (id = 'one', node = 'pve01') => ({ id, name: `Target ${id}`, api_url: 'https://pve.test:8006/', node_name: node, has_token: true, default_bridge: 'vmbr0' })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const page = (items = [target()], total = items.length, offset = 0) => ({ items, total, offset, limit: 100 })
async function load() {
  await wrapper.get('[data-testid="load-targets"]').trigger('click')
  await flushPromises()
}
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  backend = useBackendApiStore()
  backend.addHost({ url: 'https://backend.test', token: 'test-bearer', nodeName: 'pve' })
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })

describe('registered Proxmox targets in Settings', () => {
  it('lists on request with the selected profile credentials, paging the complete registry', async () => {
    const fetch = vi.fn(async (url: string) => response(url.includes('offset=1') ? page([target('two', 'pve02')], 2, 1) : page([target()], 2)))
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    expect(fetch).not.toHaveBeenCalled()
    await load()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://backend.test/v1/proxmox/hosts?offset=1&limit=100', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer test-bearer' }, method: 'GET',
    }))
    expect(wrapper.findAll('[data-testid="registered-target"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('pve01')
    expect(wrapper.text()).toContain('pve02')
    expect(wrapper.text()).toContain('does not match a registered node')
    expect(fetch.mock.calls.every(([url]) => !url.endsWith('/health'))).toBe(true)
  })

  it('updates only the chosen local profile default and makes no target mutation', async () => {
    const otherId = backend.addHost({ url: 'https://other.test', token: 'other-bearer', nodeName: 'old' })
    const fetch = vi.fn(async () => response(page()))
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: otherId } })
    await load()
    expect(fetch.mock.calls[0]).toEqual(['https://other.test/v1/proxmox/hosts?offset=0&limit=100', expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer other-bearer' } })])
    await wrapper.get('[data-testid="use-target-node"]').trigger('click')
    expect(backend.getHost(otherId)!.nodeName).toBe('pve01')
    expect(backend.activeHost!.nodeName).toBe('pve')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="status"]').text()).toContain('Existing projects keep their saved target')
  })

  it('runs a target health probe only after its Test button and reports SDN API scope', async () => {
    const fetch = vi.fn(async (url: string) => response(url.endsWith('/health') ? { status: 'ok', rtt_ms: 24, sdn_available: true, at: '2026-09-15T12:00:00Z' } : page([target('one/slash')])))
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await load()
    await wrapper.get('[data-testid="test-target"]').trigger('click'); await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith('https://backend.test/v1/proxmox/hosts/one%2Fslash/health', expect.objectContaining({ method: 'GET' }))
    expect(wrapper.text()).toContain('Reachable')
    expect(wrapper.text()).toContain('24 ms')
    expect(wrapper.text()).toContain('SDN API available')
  })

  it.each([401, 403, 500])('shows a useful HTTP %s refusal without rendering private response data', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'private-server-diagnostic' }, status)))
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await load()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/token|denied|unavailable/i)
    expect(wrapper.text()).not.toContain('private-server-diagnostic')
    expect(wrapper.find('[data-testid="use-target-node"]').exists()).toBe(false)
  })

  it('discards late results and reloads a previously requested registry after profile changes', async () => {
    let complete!: (value: Response) => void
    const fetch = vi.fn((url: string) => url.startsWith('https://backend.test') ? new Promise<Response>(resolve => { complete = resolve }) : Promise.resolve(response(page([target('new', 'new-node')]))))
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await wrapper.get('[data-testid="load-targets"]').trigger('click')
    backend.updateHost(backend.activeHost!.id, { url: 'https://replacement.test', token: 'replacement-bearer' })
    await flushPromises()
    complete(response(page([target('old', 'old-node')]))); await flushPromises()
    expect(wrapper.text()).toContain('new-node')
    expect(wrapper.text()).not.toContain('old-node')
    expect(fetch).toHaveBeenLastCalledWith('https://replacement.test/v1/proxmox/hosts?offset=0&limit=100', expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer replacement-bearer' } }))
  })

  it('does not load automatically when an untouched panel switches profiles', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await wrapper.setProps({ profileId: backend.addHost({ url: 'https://other.test' }) })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['patch', 'legacy setters'])('reloads only the completed URL/token pair after %s', async update => {
    const fetch = vi.fn(async () => response(page()))
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await load(); fetch.mockClear()

    if (update === 'patch') backend.updateHost(backend.activeHost!.id, { url: 'https://replacement.test', token: 'replacement-bearer' })
    else { backend.setUrl('https://replacement.test'); backend.setToken('replacement-bearer') }

    expect(fetch).not.toHaveBeenCalled()
    await flushPromises()
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://replacement.test/v1/proxmox/hosts?offset=0&limit=100', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer replacement-bearer' },
    }))
  })

  it('cancels a queued registry reload when the panel is unmounted', async () => {
    const fetch = vi.fn(async () => response(page()))
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await load(); fetch.mockClear()
    backend.updateHost(backend.activeHost!.id, { token: 'replacement-bearer' })
    wrapper.unmount()
    await flushPromises()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses an incomplete or changing registry instead of choosing from partial results', async () => {
    const fetch = vi.fn(async (url: string) => response(url.includes('offset=1') ? page([], 2, 1) : page([target()], 2)))
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await load()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/incomplete|changed/i)
    expect(wrapper.find('[data-testid="use-target-node"]').exists()).toBe(false)
  })

  it('requires an unambiguous node when selecting a profile default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(page([target(), target('two')]))))
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await load()
    expect(wrapper.text()).toContain('Multiple targets use this node name')
    for (const button of wrapper.findAll('[data-testid="use-target-node"]')) expect(button.attributes('disabled')).toBeDefined()
  })

  it('discards a late target health result after the backend credential changes', async () => {
    let complete!: (value: Response) => void
    const fetch = vi.fn((url: string) => url.endsWith('/health') ? new Promise<Response>(resolve => { complete = resolve }) : Promise.resolve(response(page())))
    vi.stubGlobal('fetch', fetch)
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await load()
    await wrapper.get('[data-testid="test-target"]').trigger('click')
    backend.updateHost(backend.activeHost!.id, { token: 'rotated-bearer' }); await flushPromises()
    complete(response({ status: 'ok', rtt_ms: 1, sdn_available: true })); await flushPromises()
    expect(wrapper.findAll('[data-testid="registered-target"]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Reachable')
    expect(wrapper.text()).not.toContain('SDN API available')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not display untrusted transport diagnostics as a target error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('private-transport-diagnostic') }))
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await load()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/unreachable/i)
    expect(wrapper.text()).not.toContain('private-transport-diagnostic')
  })

  it('refuses malformed health rather than showing a successful target probe', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/health') ? { status: 'ok', rtt_ms: '24', sdn_available: true } : page())))
    wrapper = mount(RegisteredTargetsPanel, { props: { profileId: backend.activeHost!.id } })
    await load()
    await wrapper.get('[data-testid="test-target"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('invalid target health')
    expect(wrapper.text()).not.toContain('Reachable')
  })
})
