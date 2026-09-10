import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import PublicationReviewActions from '@/components/PublicationReviewActions.vue'
import publishing from '@/locales/en/publishing.json'
const { getPullRequest, mergePullRequest } = vi.hoisted(() => ({ getPullRequest: vi.fn(), mergePullRequest: vi.fn() }))
vi.mock('@/composables/useProjectGitSync', () => ({ providerForBinding: () => ({ getPullRequest, mergePullRequest }) }))
enableAutoUnmount(afterEach)
const head = 'a'.repeat(40)
const destination = { id: 'public', source_id: 's', provider: 'github', base_url: 'https://github.com', repo_owner: 'org', repo_name: 'repo', base_branch: 'main', mode: 'pull_request' }
const result = { target_id: 'public', status: 'published', mode: 'pull_request', pr_number: 7, commit_sha: head, destination }
const review = { number: 7, head_sha: head, can_merge: true, mergeable: true, state: 'open' }
function modal(overrides = {}) {
  return mount(PublicationReviewActions, { props: { result: { ...result, ...overrides } }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { publishing } } })] } })
}
beforeEach(() => {
  vi.clearAllMocks()
  getPullRequest.mockResolvedValue(review)
  mergePullRequest.mockResolvedValue({ merged: true })
})
describe('publication review actions', () => {
  it('checks permissions before showing a merge action and merges only on explicit click', async () => {
    const wrapper = modal()
    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="merge-publication"]').exists()).toBe(false)
    await wrapper.get('[data-testid="check-publication"]').trigger('click')
    await flushPromises()
    expect(mergePullRequest).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="merge-publication"]').trigger('click')
    await flushPromises()
    expect(mergePullRequest).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', number: 7, expectedHead: head, method: 'merge' })
    expect(wrapper.emitted('updated')[0][0]).toMatchObject({ merged: true, commit_sha: head })
    expect(wrapper.text()).toContain('Merged')
  })
  it.each([{ can_merge: false }, { mergeable: false }, { head_sha: 'b'.repeat(40) }])('keeps merge disabled when the publication is not eligible: %j', async changes => {
    getPullRequest.mockResolvedValue({ ...review, ...changes })
    const wrapper = modal()
    await wrapper.get('[data-testid="check-publication"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="merge-publication"]').attributes('disabled')).toBeDefined()
    expect(mergePullRequest).not.toHaveBeenCalled()
  })
  it('shows policy failures and preserves the publication as unmerged', async () => {
    mergePullRequest.mockRejectedValue(new Error('Required approval missing'))
    const wrapper = modal()
    await wrapper.get('[data-testid="check-publication"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="merge-publication"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Required approval missing')
    expect(wrapper.emitted('updated')).toBeUndefined()
  })
})
