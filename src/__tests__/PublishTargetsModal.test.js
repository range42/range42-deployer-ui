import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import PublishTargetsModal from '@/components/PublishTargetsModal.vue'
import PublicationReviewActions from '@/components/PublicationReviewActions.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import publishing from '@/locales/en/publishing.json'

const { publishFilesToTargets, loadSources } = vi.hoisted(() => ({
  publishFilesToTargets: vi.fn(), loadSources: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/composables/useProjectGitSync', () => ({
  publishFilesToTargets, workingBranchForProject: (id) => `range42-ui/${encodeURIComponent(id)}`,
}))
vi.mock('@/composables/useCatalogSources', () => ({
  useCatalogSources: () => ({ loadSources, loading: false }),
}))
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn() }))
vi.mock('focus-trap-vue', () => ({
  FocusTrap: { template: '<div><slot /></div>' },
}))
enableAutoUnmount(afterEach)

const sources = [
  { id: 'github', provider: 'github', base_url: 'https://github.com', auth: { kind: 'pat' },
    repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }] },
  { id: 'private', provider: 'gitlab', base_url: 'https://git.example.test', auth: { kind: 'pat' },
    repos: [{ owner: 'team/internal', repo: 'inventory', branch: 'main' }] },
  { id: 'gitea', provider: 'gitea', base_url: 'https://gitea.example.test', auth: { kind: 'pat' },
    repos: [{ owner: 'team', repo: 'library', branch: 'dev' }] },
]
const binding = { source_id: 'private', provider: 'gitlab', base_url: sources[1].base_url,
  repo_owner: 'team/internal', repo_name: 'inventory', branch: 'main',
  branch_strategy: 'dedicated_repo', working_branch: 'range42-ui/project-1' }
const targets = sources.map((source, index) => ({
  id: `target-${index}`, source_id: source.id, provider: source.provider,
  base_url: source.base_url, repo_owner: source.repos[0].owner,
  repo_name: source.repos[0].repo, base_branch: source.repos[0].branch,
  mode: index === 1 ? 'direct' : 'pull_request',
}))

function modal(props = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const inventory = useInventoryStore()
  inventory.sources = structuredClone(sources)
  for (const source of sources) inventory.setToken(source.id, `test-publishing-${source.id}`)
  const wrapper = mount(PublishTargetsModal, {
    props: { open: true, projectId: 'project-1', binding,
      files: { 'scenarios/demo/main.yml': '- hosts: demo\n' },
      message: 'Publish demo', initialTargets: targets, ...props },
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: { publishing } } })] },
  })
  return { wrapper, inventory }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('explicit Git publication', () => {
  it('reviews fork behavior and preserves the actual personal checkpoint repository on retry', async () => {
    const { wrapper } = modal()
    await wrapper.findAll('[data-testid="target-selected"]')[0].setValue(true)
    await wrapper.findAll('[data-testid="fork-policy"]')[0].setValue('fork')
    await wrapper.get('[data-testid="review-publish"]').trigger('click')
    expect(wrapper.get('[data-testid="publish-preview"]').text()).toContain('Always use my personal fork')
    const forkBinding = { ...binding, repo_owner: 'me', fork_policy: 'upstream' }
    publishFilesToTargets.mockResolvedValueOnce({ binding: forkBinding, branch: binding.working_branch, commit_sha: 'abc',
      targets: [{ target_id: 'target-0', mode: 'pull_request', status: 'failed', error: 'Try again' }] })
    await wrapper.get('[data-testid="confirm-publish"]').trigger('click')
    await flushPromises()
    expect(publishFilesToTargets.mock.calls[0][1][0].fork_policy).toBe('fork')
    expect(wrapper.get('[data-testid="publish-preview"]').text()).toContain('me/inventory')
    publishFilesToTargets.mockResolvedValueOnce({ branch: binding.working_branch, commit_sha: 'abc', targets: [] })
    await wrapper.get('[data-testid="retry-target-0"]').trigger('click')
    await flushPromises()
    expect(publishFilesToTargets.mock.calls[1][0].binding).toEqual(forkBinding)
  })
  it('offers persisted publication reviews without publishing again', async () => {
    const saved = { target_id: targets[0].id, mode: 'pull_request', status: 'published', pr_number: 7,
      commit_sha: 'a'.repeat(40), pr_url: 'https://github.com/range42/catalog/pull/7', destination: targets[0] }
    const { wrapper } = modal({ binding: { ...binding, publish_results: [saved] } })
    await flushPromises()
    expect(wrapper.findComponent(PublicationReviewActions).props('result')).toEqual(saved)
    expect(publishFilesToTargets).not.toHaveBeenCalled()
  })

  it('reviews exact files and chosen destinations before publishing an immutable snapshot', async () => {
    const { wrapper } = modal()
    expect(publishFilesToTargets).not.toHaveBeenCalled()
    expect(wrapper.findAll('[data-testid="target-selected"]')).toHaveLength(3)
    expect(wrapper.findAll('[data-testid="target-selected"]').every((input) => !input.element.checked)).toBe(true)
    await wrapper.findAll('[data-testid="target-selected"]')[0].setValue(true)
    await wrapper.findAll('[data-testid="target-selected"]')[1].setValue(true)
    await wrapper.get('[data-testid="review-publish"]').trigger('click')
    expect(wrapper.get('[data-testid="publish-preview"]').text()).toContain('scenarios/demo/main.yml')
    expect(wrapper.get('[data-testid="publish-preview"]').text()).toContain('range42/catalog')
    expect(wrapper.get('[data-testid="publish-preview"]').text()).toContain('team/internal/inventory')
    expect(wrapper.get('[data-testid="publish-preview"]').text()).not.toContain('team/library')
    expect(publishFilesToTargets).not.toHaveBeenCalled()
    await wrapper.setProps({ projectId: 'different-project', files: { 'different.yml': 'not reviewed' } })
    publishFilesToTargets.mockResolvedValue({ commit_sha: 'a'.repeat(40), branch: binding.working_branch,
      targets: [{ target_id: 'target-0', status: 'published', mode: 'pull_request', pr_url: 'https://github.com/range42/catalog/pull/7' },
        { target_id: 'target-1', status: 'published', mode: 'direct', commit_sha: 'b'.repeat(40) }] })

    await wrapper.get('[data-testid="confirm-publish"]').trigger('click')
    await flushPromises()

    expect(publishFilesToTargets).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', binding, files: { 'scenarios/demo/main.yml': '- hosts: demo\n' }, message: 'Publish demo',
    }), targets.slice(0, 2))
    expect(wrapper.emitted('published')).toHaveLength(1)
    expect(wrapper.get('a[href="https://github.com/range42/catalog/pull/7"]').text()).toContain('pull request')
  })

  it('retries only a failed destination while preserving successful results', async () => {
    const { wrapper } = modal()
    await wrapper.findAll('[data-testid="target-selected"]')[0].setValue(true)
    await wrapper.findAll('[data-testid="target-selected"]')[1].setValue(true)
    await wrapper.get('[data-testid="review-publish"]').trigger('click')
    publishFilesToTargets.mockResolvedValueOnce({ commit_sha: 'a'.repeat(40), branch: binding.working_branch,
      targets: [{ target_id: 'target-0', status: 'published', mode: 'pull_request', pr_url: 'https://github.com/range42/catalog/pull/7' },
        { target_id: 'target-1', status: 'failed', mode: 'direct', error: 'Provider denied write access' }] })
    await wrapper.get('[data-testid="confirm-publish"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Provider denied write access')
    publishFilesToTargets.mockResolvedValueOnce({ commit_sha: 'a'.repeat(40), branch: binding.working_branch,
      targets: [{ target_id: 'target-1', status: 'published', mode: 'direct', commit_sha: 'b'.repeat(40) }] })

    await wrapper.get('[data-testid="retry-target-1"]').trigger('click')
    await flushPromises()

    expect(publishFilesToTargets.mock.calls[1][1]).toEqual([targets[1]])
    expect(wrapper.find('a[href="https://github.com/range42/catalog/pull/7"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="retry-target-1"]').exists()).toBe(false)
  })

  it('requires an explicit destination and valid Git branch before review', async () => {
    const { wrapper } = modal()
    await wrapper.get('[data-testid="review-publish"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('Select at least one destination')
    await wrapper.findAll('[data-testid="target-selected"]')[0].setValue(true)
    await wrapper.findAll('[data-testid="repository-branch"]')[0].setValue('bad..branch')
    await wrapper.get('[data-testid="review-publish"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('valid Git branch')
    expect(publishFilesToTargets).not.toHaveBeenCalled()
  })

  it('lets an unbound new role choose a working repository and forwards create-only intent', async () => {
    const { wrapper } = modal({ binding: undefined, initialTargets: [], createOnly: true,
      componentPath: '02_ansible_layer/admin/roles/demo',
      files: { '02_ansible_layer/admin/roles/demo/tasks/main.yml': '- name: Demo\n' } })
    await wrapper.get('[data-testid="working-repository"] [data-testid="repository-source"]').setValue('private')
    await wrapper.get('[data-testid="add-target"]').trigger('click')
    await wrapper.get('[data-testid="publish-target"] [data-testid="repository-source"]').setValue('github')
    await wrapper.get('[data-testid="review-publish"]').trigger('click')
    expect(wrapper.get('[data-testid="publish-preview"]').text()).toContain('New files only')
    publishFilesToTargets.mockResolvedValue({ commit_sha: 'a'.repeat(40), branch: 'range42-ui/project-1', targets: [] })
    await wrapper.get('[data-testid="confirm-publish"]').trigger('click')
    await flushPromises()
    expect(publishFilesToTargets.mock.calls[0][0]).toMatchObject({
      createOnly: true, componentPath: '02_ansible_layer/admin/roles/demo',
      binding: { source_id: 'private', repo_owner: 'team/internal', repo_name: 'inventory', branch: 'main' },
    })
  })

  it('blocks a source change after review and never exposes source credentials', async () => {
    const { wrapper, inventory } = modal()
    inventory.sources[0].token_ref = 'NEVER-SHOW-TOKEN'
    await wrapper.findAll('[data-testid="target-selected"]')[0].setValue(true)
    await wrapper.get('[data-testid="review-publish"]').trigger('click')
    inventory.sources[0].base_url = 'https://different.example.test'
    await wrapper.get('[data-testid="confirm-publish"]').trigger('click')
    expect(publishFilesToTargets).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('NEVER-SHOW-TOKEN')
    expect(wrapper.get('[role="alert"]').text()).toContain('source configuration changed')
  })

  it('connects separate browser publishing credentials, clears the password and excludes it from publication metadata', async () => {
    const { wrapper, inventory } = modal()
    inventory.setToken('github', '')
    const storeToken = vi.spyOn(inventory, 'setToken')
    await wrapper.findAll('[data-testid="target-selected"]')[0].setValue(true)
    await wrapper.get('[data-testid="review-publish"]').trigger('click')
    await wrapper.get('[data-testid="confirm-publish"]').trigger('click')
    expect(publishFilesToTargets).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('Connect publishing credentials')
    const credential = wrapper.get('[data-testid="publishing-credential-github"]')
    expect(credential.element.value).toBe('')
    await credential.setValue('SECRET-PUBLISHING-TOKEN')
    await wrapper.get('[data-testid="connect-credential-github"]').trigger('click')
    expect(storeToken).toHaveBeenCalledWith('github', 'SECRET-PUBLISHING-TOKEN')
    expect(credential.element.value).toBe('')
    expect(wrapper.text()).not.toContain('SECRET-PUBLISHING-TOKEN')
    publishFilesToTargets.mockResolvedValue({ commit_sha: 'a'.repeat(40), branch: binding.working_branch,
      targets: [{ target_id: 'target-0', status: 'published', mode: 'pull_request' }] })
    await wrapper.get('[data-testid="confirm-publish"]').trigger('click')
    await flushPromises()
    expect(JSON.stringify(publishFilesToTargets.mock.calls)).not.toContain('SECRET-PUBLISHING-TOKEN')
  })
})
