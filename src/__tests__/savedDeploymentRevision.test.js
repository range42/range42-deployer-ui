import { afterEach, it, expect, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import 'fake-indexeddb/auto'
import { createProjectRepoAdapter } from '@/services/projectRepo'
import DeployForm from '@/components/project/DeployForm.vue'
import deployment from '@/locales/en/deployment.json'
import common from '@/locales/en/common.json'

enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllGlobals())

it('saves without writing main and creates a deployment pinned to that working branch commit', async () => {
  localStorage.clear()
  setActivePinia(createPinia())
  const revision = '1234567890abcdef1234567890abcdef12345678'
  const puts = []
  const provider = {
    canWrite: async () => true,
    createBranch: async () => {},
    getFile: async () => { throw new Error('404 not found') },
    putFile: async options => { puts.push(options); return { sha: 'blob' } },
    listCommits: async ({ ref }) => [{ sha: ref === 'range42-ui/project-1' ? revision : 'wrong-main-revision' }],
  }
  const adapter = createProjectRepoAdapter({
    provider, source: { id: 'source', provider: 'github', repos: [{ owner: 'owner', repo: 'project', branch: 'main' }] },
    branchStrategy: 'dedicated_repo', projectPath: '', workingBranch: 'range42-ui/project-1',
  })
  await adapter.autosave('project-1', { overlay: '', canvas_layout: '{}', meta: {}, topology: '{}' })
  const saved = await adapter.save('project-1', 'Save')
  expect(puts.every(write => write.branch === 'range42-ui/project-1')).toBe(true)
  const fetch = vi.fn(async url => ({ ok: true, status: 200, json: async () => url.includes('/hosts')
    ? { items: [{ id: 'host', name: 'pve01' }], total: 1 }
    : { id: 'deployment-1' },
  }))
  vi.stubGlobal('fetch', fetch)
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/deployments/:id', name: 'deployment-detail', component: { template: '<div />' } },
  ] })
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { deployment, common } } })
  const wrapper = mount(DeployForm, {
    props: { visible: true, projectId: 'project-1', projectSha: saved.commit_sha, gamenet: false },
    global: { plugins: [router, i18n] },
  })
  await flushPromises()
  await wrapper.find('[data-testid="deploy-field-codename"] input').setValue('SCRIPT_LAB')
  await wrapper.find('[data-testid="deploy-field-scenario"] input').setValue('script_lab')
  await wrapper.find('[data-testid="deploy-field-host"] select').setValue('host')
  await wrapper.find('[data-testid="deploy-field-vault"] input').setValue('vault')
  await wrapper.find('[data-testid="deploy-sha-ack"] input').setValue(true)
  await wrapper.find('[data-testid="deploy-submit"]').trigger('click')
  await flushPromises()
  const request = fetch.mock.calls.find(([url]) => url.endsWith('/deployments'))
  expect(JSON.parse(request[1].body).project_sha).toBe(revision)
})
