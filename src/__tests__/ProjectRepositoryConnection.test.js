import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import ProjectRepositoryConnection from '@/components/ProjectRepositoryConnection.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import publishing from '@/locales/en/publishing.json'

vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
const { rotateToken } = vi.hoisted(() => ({ rotateToken: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/composables/useCatalogSources', () => ({ useCatalogSources: () => ({ loadSources: vi.fn(), rotateToken, loading: false }) }))
vi.mock('focus-trap-vue', () => ({ FocusTrap: { template: '<div><slot /></div>' } }))
enableAutoUnmount(afterEach)

function modal() {
  localStorage.clear()
  const pinia = createPinia()
  setActivePinia(pinia)
  const inventory = useInventoryStore()
  inventory.sources = [{ id: 'github', provider: 'github', base_url: 'https://github.com', auth: { kind: 'none' },
    repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }] }]
  const wrapper = mount(ProjectRepositoryConnection, { props: { open: true },
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: { publishing } } })] } })
  return { wrapper, inventory }
}

describe('project repository connection', () => {
  it('connects an explicit source and personal-fork policy without publishing or exposing credentials', async () => {
    const { wrapper, inventory } = modal()
    expect(wrapper.find('[data-testid="repository-source"]').exists()).toBe(true)
    await wrapper.get('[data-testid="repository-source"]').setValue('github')
    await wrapper.get('[data-testid="repository-subdir"]').setValue('labs/demo')
    await wrapper.get('[data-testid="repository-credential"]').setValue('secret-test-token')
    await wrapper.get('[data-testid="connect-project-repository"]').trigger('click')
    await flushPromises()
    const binding = wrapper.emitted('connected')[0][0]
    expect(binding).toMatchObject({ source_id: 'github', provider: 'github', base_url: 'https://github.com',
      repo_owner: 'range42', repo_name: 'catalog', branch: 'main', subdir: 'labs/demo', branch_strategy: 'shared_repo_subdir', fork_policy: 'auto' })
    expect(inventory.getToken('github')).toBe('secret-test-token')
    expect(JSON.stringify(binding)).not.toContain('secret-test-token')
    expect(wrapper.get('[data-testid="repository-credential"]').element.value).toBe('')
  })
  it('persists an explicitly selected organization fork namespace', async () => {
    const { wrapper } = modal()
    await wrapper.get('[data-testid="repository-source"]').setValue('github')
    await wrapper.get('[data-testid="fork-destination"]').setValue('training-team')
    await wrapper.get('[data-testid="connect-project-repository"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('connected')[0][0].fork_owner).toBe('training-team')
  })
  it('sends a private-clone credential to the selected backend only when explicitly enabled', async () => {
    const { wrapper, inventory } = modal()
    inventory.sources[0].backend_url = ''
    await wrapper.get('[data-testid="repository-source"]').setValue('github')
    await wrapper.get('[data-testid="repository-credential"]').setValue('private-test-token')
    await wrapper.get('[data-testid="backend-clone-credential"]').setValue(true)
    await wrapper.get('[data-testid="connect-project-repository"]').trigger('click')
    await flushPromises()
    expect(rotateToken).toHaveBeenCalledWith('github', 'private-test-token')
    expect(JSON.stringify(wrapper.emitted('connected'))).not.toContain('private-test-token')
  })

  it('does not save a browser token or connection if the source changes during backend credential storage', async () => {
    const { wrapper, inventory } = modal()
    inventory.sources[0].backend_url = ''
    let finish
    rotateToken.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.get('[data-testid="repository-source"]').setValue('github')
    await wrapper.get('[data-testid="repository-credential"]').setValue('private-test-token')
    await wrapper.get('[data-testid="backend-clone-credential"]').setValue(true)
    await wrapper.get('[data-testid="connect-project-repository"]').trigger('click')
    inventory.sources[0].base_url = 'https://different.test'
    finish()
    await flushPromises()
    expect(wrapper.emitted('connected')).toBeUndefined()
    expect(inventory.getToken('github')).toBeFalsy()
    expect(wrapper.get('[role="alert"]').text()).toContain('changed')
  })

  it('blocks invalid branch and directory paths before saving credentials', async () => {
    const { wrapper, inventory } = modal()
    expect(wrapper.find('[data-testid="repository-source"]').exists()).toBe(true)
    await wrapper.get('[data-testid="repository-source"]').setValue('github')
    await wrapper.get('[data-testid="repository-branch"]').setValue('bad..branch')
    await wrapper.get('[data-testid="repository-credential"]').setValue('secret-test-token')
    await wrapper.get('[data-testid="connect-project-repository"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('valid Git branch')
    expect(wrapper.emitted('connected')).toBeUndefined()
    expect(inventory.getToken('github')).toBeFalsy()
  })
  it('clears unsubmitted credentials when the selected source identity changes', async () => {
    const { wrapper, inventory } = modal()
    expect(wrapper.find('[data-testid="repository-source"]').exists()).toBe(true)
    await wrapper.get('[data-testid="repository-source"]').setValue('github')
    await wrapper.get('[data-testid="repository-credential"]').setValue('secret-test-token')
    inventory.sources[0].base_url = 'https://different.test'
    await flushPromises()
    expect(wrapper.get('[data-testid="repository-credential"]').element.value).toBe('')
  })
})
