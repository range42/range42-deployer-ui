import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import BundleLibraryModal from '@/components/project/BundleLibraryModal.vue'
import bundles from '@/locales/en/bundles.json'

const api = vi.hoisted(() => ({ listEntries: vi.fn(), getEntry: vi.fn(), backendRequest: vi.fn(), connectDefault: vi.fn(), refreshSource: vi.fn() }))
vi.mock('@/composables/useCatalog', () => ({ useCatalog: () => ({ ...api, error: { value: null } }) }))
vi.mock('@/composables/useCatalogSources', () => ({ useCatalogSources: () => api }))
vi.mock('@/services/backendApi', async importOriginal => ({ ...await importOriginal(), backendRequest: api.backendRequest }))
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
vi.mock('focus-trap-vue', () => ({ FocusTrap: { template: '<div><slot /></div>' } }))
enableAutoUnmount(afterEach)
const entry = { kind: 'bundle', source_id: 'bundles', path: 'bundles/generic/software.install.demo', name: 'Install demo', sha: 'a'.repeat(40), tags: ['generic', 'VM'] }
const resolution = { source_id: 'bundles', source_sha: entry.sha, path: entry.path, entrypoint: 'generic/software.install.demo/main.yml', bundle_kind: 'VM',
  params: [{ name: 'PORT', type: 'int', required: true, default: 80 }, { name: 'vault_key', type: 'string', from_vault: true, required: true }, { name: 'global_vm_ssh_name', type: 'string', target: true }],
  target_vars: ['global_vm_ssh_name'], runtime: { fingerprint: 'b'.repeat(64), proof: 'sealed-runtime-proof', dependencies: [{ name: 'range42-catalog', revision: 'd'.repeat(40), sha256: 'e'.repeat(64) }] }, proof_kind: 'content_match' }
function modal() {
  localStorage.clear()
  setActivePinia(createPinia())
  return mount(BundleLibraryModal, { props: { open: true, vms: [{ node_id: 'vm-1', vm_name: 'web' }] },
    global: { stubs: { teleport: true }, plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { bundles } } })] } })
}
beforeEach(() => {
  vi.resetAllMocks()
  api.listEntries.mockResolvedValue([entry])
  api.getEntry.mockResolvedValue({ ...entry, document: { bundle_kind: 'VM' } })
  api.backendRequest.mockResolvedValue(resolution)
})

describe('executable bundle library', () => {
  it('loads and searches bundle entries across registered sources', async () => {
    const wrapper = modal()
    await flushPromises()
    expect(api.listEntries).toHaveBeenCalledWith({ kind: 'bundle', limit: 100 })
    expect(wrapper.text()).toContain('Install demo')
    await wrapper.get('[data-testid="bundle-search"]').setValue('unrelated')
    expect(wrapper.find('[data-testid="bundle-choice"]').exists()).toBe(false)
  })
  it('resolves exact source revision and emits typed values with sealed runtime provenance', async () => {
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="bundle-choice"]').trigger('click')
    await flushPromises()
    expect(api.backendRequest).toHaveBeenCalledWith('/v1/catalog/sources/bundles/bundles/resolve', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(api.backendRequest.mock.calls[0][1].body)).toEqual({ path: entry.path, sha: entry.sha, target_kind: 'VM' })
    expect(wrapper.text()).toContain('range42-catalog')
    expect(wrapper.find('[data-testid="bundle-param-vault_key"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="bundle-param-global_vm_ssh_name"]').exists()).toBe(false)
    await wrapper.get('[data-testid="bundle-param-PORT"]').setValue('8080')
    await wrapper.get('[data-testid="bundle-attach"]').trigger('click')
    expect(wrapper.emitted('selected')[0][0]).toMatchObject({ kind: 'bundle', target_node: 'vm-1', path: resolution.entrypoint, vars: { PORT: 8080 }, resolution })
  })
  it('renders canonical booleans and JSON-object parameters from the descriptor', async () => {
    api.backendRequest.mockResolvedValue({ ...resolution, params: [
      { name: 'FLAG', type: 'bool', bool_style: 'yesno', allowed: ['YES', 'NO'], default: 'YES' },
      { name: 'OPTIONS', type: 'dict', default: { enabled: true } },
    ] })
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="bundle-choice"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="bundle-param-FLAG"]').element.value).toBe('true')
    expect(wrapper.get('[data-testid="bundle-param-OPTIONS"]').element.tagName).toBe('TEXTAREA')
    await wrapper.get('[data-testid="bundle-attach"]').trigger('click')
    expect(wrapper.emitted('selected')[0][0].vars).toEqual({ FLAG: 'YES', OPTIONS: { enabled: true } })
  })

  it('shows runtime mismatch errors without allowing an unverified attachment', async () => {
    api.backendRequest.mockRejectedValue(new Error('Bundle content does not match the installed runtime'))
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="bundle-choice"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('does not match')
    expect(wrapper.find('[data-testid="bundle-attach"]').exists()).toBe(false)
    expect(wrapper.emitted('selected')).toBeUndefined()
  })
  it.each([
    { ...resolution, source_sha: 'c'.repeat(40) },
    { ...resolution, bundle_kind: 'GROUP' },
    { ...resolution, runtime: { fingerprint: 'b'.repeat(64) } },
  ])('rejects a response without matching VM provenance', async result => {
    api.backendRequest.mockResolvedValue(result)
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="bundle-choice"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('provenance')
    expect(wrapper.find('[data-testid="bundle-attach"]').exists()).toBe(false)
  })
  it('shows parameter errors and keeps incomplete values out of scenario content', async () => {
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="bundle-choice"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="bundle-param-PORT"]').setValue('1.5')
    await wrapper.get('[data-testid="bundle-attach"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('PORT')
    expect(wrapper.emitted('selected')).toBeUndefined()
  })

  it('ignores a resolution completed after the library closes', async () => {
    let finish
    api.backendRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="bundle-choice"]').trigger('click')
    await flushPromises()
    await wrapper.setProps({ open: false })
    finish(resolution)
    await flushPromises()
    expect(wrapper.find('[data-testid="bundle-attach"]').exists()).toBe(false)
    expect(wrapper.emitted('selected')).toBeUndefined()
  })
  it('connects and refreshes the dedicated default bundle library', async () => {
    api.connectDefault.mockResolvedValue({ id: 'default-bundles' })
    const wrapper = modal()
    await flushPromises()
    await wrapper.get('[data-testid="bundle-default"]').trigger('click')
    await flushPromises()
    expect(api.connectDefault).toHaveBeenCalledWith('bundles')
    expect(api.refreshSource).toHaveBeenCalledWith('default-bundles')
    expect(api.listEntries).toHaveBeenCalledTimes(2)
  })
})
