import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import OpenProjectFromGitModal from '@/components/OpenProjectFromGitModal.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import { buildPushArgs, buildProjectFiles } from '@/composables/useProjectGitSync'
import { savedScenario } from './fixtures/savedScenario'
import publishing from '@/locales/en/publishing.json'
import reopening from '@/locales/en/reopening.json'

vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
vi.mock('@/composables/useCatalogSources', () => ({ useCatalogSources: () => ({ loadSources: vi.fn() }) }))
vi.mock('focus-trap-vue', () => ({ FocusTrap: { template: '<div><slot /></div>' } }))
const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('@/services/git', () => ({ getProvider }))
enableAutoUnmount(afterEach)
beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

function modal() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const inventory = useInventoryStore()
  const project = savedScenario()
  inventory.sources = [{ id: 'source', provider: 'github', base_url: 'https://github.com', auth: { kind: 'none' },
    repos: [{ owner: 'owner', repo: 'repo', branch: 'review' }] }]
  const files = buildProjectFiles(buildPushArgs(project, project.nodes, project.edges))
  const provider = { listCommits: vi.fn(async () => [{ sha: 'a'.repeat(40) }]),
    getFileContent: vi.fn(async ({ path }) => ({ content: files[path], sha: 'blob' })), createBranch: vi.fn() }
  getProvider.mockReturnValue(provider)
  const wrapper = mount(OpenProjectFromGitModal, { props: { open: true }, global: {
    plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: { publishing, reopening } } })],
  } })
  return { wrapper, files, inventory, provider }
}

describe('Open from Git review', () => {
  it('shows the pinned preview and imports only after an explicit click', async () => {
    const { wrapper, provider } = modal()
    await wrapper.get('[data-testid="repository-source"]').setValue('source')
    await wrapper.get('[data-testid="open-git-preview"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="open-git-revision"]').text()).toContain('a'.repeat(40))
    expect(wrapper.text()).toContain('project_saved')
    expect(wrapper.text()).toContain('range42-ui/open-')
    expect(useProjectStore().projects).toHaveLength(0)
    expect(provider.createBranch).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="open-git-import"]').trigger('click')
    expect(useProjectStore().projects).toHaveLength(1)
    expect(wrapper.emitted('opened')[0][0].id).toBe('project_saved')
  })

  it('requires acknowledgement before importing manual generated-file edits as files only', async () => {
    const { wrapper, files } = modal()
    files['scenarios/saved/main.yml'] = '# manual maintenance\n'
    await wrapper.get('[data-testid="repository-source"]').setValue('source')
    await wrapper.get('[data-testid="open-git-preview"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="open-git-import"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="open-git-files-only"]').setValue(true)
    await wrapper.get('[data-testid="open-git-import"]').trigger('click')
    expect(useProjectStore().projects[0].scenario).toBeUndefined()
    expect(useProjectStore().projects[0].files['scenarios/saved/main.yml']).toBe('# manual maintenance\n')
  })

  it('discards an in-flight preview if source identity changes and clears unsubmitted credentials', async () => {
    const { wrapper, inventory, provider } = modal()
    let release
    provider.listCommits.mockImplementation(() => new Promise(resolve => { release = resolve }))
    await wrapper.get('[data-testid="repository-source"]').setValue('source')
    await wrapper.get('[data-testid="open-git-preview"]').trigger('click')
    await flushPromises()
    inventory.sources[0].base_url = 'https://different.test'
    release([{ sha: 'a'.repeat(40) }])
    await flushPromises()
    expect(wrapper.find('[data-testid="open-git-revision"]').exists()).toBe(false)
    expect(wrapper.text()).toMatch(/source|changed/i)
    expect(useProjectStore().projects).toHaveLength(0)
  })

  it('keeps the preview and all earlier projects when persistence fails', async () => {
    const { wrapper } = modal()
    await wrapper.get('[data-testid="repository-source"]').setValue('source')
    await wrapper.get('[data-testid="open-git-preview"]').trigger('click')
    await flushPromises()
    const storage = globalThis.localStorage
    vi.stubGlobal('localStorage', {
      getItem: storage.getItem.bind(storage),
      setItem: () => { throw new DOMException('Full', 'QuotaExceededError') },
    })
    try {
      await wrapper.get('[data-testid="open-git-import"]').trigger('click')
      expect(wrapper.get('[role="alert"]').text()).toMatch(/storage/i)
      expect(wrapper.find('[data-testid="open-git-revision"]').exists()).toBe(true)
      expect(wrapper.emitted('opened')).toBeUndefined()
    } finally { vi.unstubAllGlobals() }
  })

  it('does not let an old request change the loading/error state of a new connection', async () => {
    const { wrapper, inventory, provider } = modal()
    let failOld, finishNew
    provider.listCommits.mockImplementationOnce(() => new Promise((_, reject) => { failOld = reject }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
    await wrapper.get('[data-testid="repository-source"]').setValue('source')
    await wrapper.get('[data-testid="open-git-preview"]').trigger('click')
    await flushPromises()
    inventory.sources[0].base_url = 'https://new.test'
    await flushPromises()
    await wrapper.get('[data-testid="open-git-preview"]').trigger('click')
    await flushPromises()
    failOld(new Error('Old connection failed'))
    await flushPromises()
    expect(wrapper.get('[data-testid="open-git-preview"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('Old connection failed')
    finishNew([{ sha: 'a'.repeat(40) }])
    await flushPromises()
    expect(wrapper.find('[data-testid="open-git-revision"]').exists()).toBe(true)
  })

  it.each(['during reading', 'before import'])('requires a fresh preview after Git token rotation %s', async when => {
    const { wrapper, inventory, provider } = modal()
    let finish
    if (when === 'during reading') provider.listCommits.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.get('[data-testid="repository-source"]').setValue('source')
    await wrapper.get('[data-testid="open-git-preview"]').trigger('click')
    await flushPromises()
    inventory.setToken('source', 'rotated-token')
    if (finish) finish([{ sha: 'a'.repeat(40) }])
    else await wrapper.get('[data-testid="open-git-import"]').trigger('click')
    await flushPromises()
    expect(useProjectStore().projects).toHaveLength(0)
    expect(wrapper.find('[data-testid="open-git-revision"]').exists()).toBe(false)
    expect(wrapper.text()).toMatch(/changed/i)
  })
})
