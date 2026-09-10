import { afterEach, beforeEach, expect, it } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppShell from '@/components/AppShell.vue'

enableAutoUnmount(afterEach)
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })

it.each([undefined, { source_id: 'source', repo_owner: 'team', repo_name: 'lab' }])('opens existing projects without an automatic bulk migration (Git: %s)', async git => {
  const saved = JSON.stringify([{ id: 'project-1', name: 'Existing work', nodes: [], edges: [], git,
    scenario: { label: 'demo' }, files: { 'content/existing.txt': 'keep me' } }])
  localStorage.setItem('range42_projects', saved)
  const router = createRouter({ history: createMemoryHistory(), routes: ['/', '/catalog', '/deployments', '/sources', '/settings'].map(path => ({ path, component: { template: '<p>Projects</p>' } })) })
  await router.push('/')
  const wrapper = mount(AppShell, { global: { plugins: [router], stubs: { BackendAccessPanel: true,
    MigrationWizard: { template: '<div role="dialog">Bulk migration</div>' }, LegacyStorageBanner: true } } })
  await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(localStorage.getItem('range42_projects')).toBe(saved)
  expect(localStorage.getItem('range42_projects_legacy')).toBeNull()
})
