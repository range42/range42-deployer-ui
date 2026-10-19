import { afterEach, beforeEach, expect, it } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import { i18n } from '@/i18n'

enableAutoUnmount(afterEach)
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })

it.each([undefined, { source_id: 'source', repo_owner: 'team', repo_name: 'lab' }])('opens existing projects without an automatic bulk migration (Git: %s)', async git => {
  const saved = JSON.stringify([{ id: 'project-1', name: 'Existing work', nodes: [], edges: [], git,
    scenario: { label: 'demo' }, files: { 'content/existing.txt': 'keep me' } }])
  localStorage.setItem('range42_projects', saved)
  const router = createRouter({ history: createMemoryHistory(), routes: ['/', '/catalog', '/deployments', '/sources', '/settings'].map(path => ({ path, component: { template: '<p>Projects</p>' } })) })
  await router.push('/')
  const wrapper = mount(AppShell, { global: { plugins: [router, i18n], stubs: { BackendAccessPanel: true,
    MigrationWizard: { template: '<div role="dialog">Bulk migration</div>' }, LegacyStorageBanner: true } } })
  await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(localStorage.getItem('range42_projects')).toBe(saved)
  expect(localStorage.getItem('range42_projects_legacy')).toBeNull()
})

it('shows a safe reload link when a lazy page fails and clears it after successful navigation', async () => {
  const failure = new Error('Failed to fetch dynamically imported module: private-request-details')
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<p>Projects</p>' } },
    { path: '/catalog', component: () => Promise.reject(failure) },
    { path: '/deployments', component: { template: '<p>Deployments</p>' } },
    ...['/sources', '/settings'].map(path => ({ path, component: { template: '<p>Page</p>' } })),
  ] })
  router.onError(() => {})
  await router.push('/')
  const wrapper = mount(AppShell, { global: { plugins: [router, i18n],
    stubs: { BackendAccessPanel: true, LegacyStorageBanner: true } } })
  await flushPromises()
  await expect(router.push('/catalog')).rejects.toBe(failure)
  await flushPromises()
  expect(wrapper.find('[data-testid="route-load-error"]').exists()).toBe(true)
  expect(wrapper.get('[data-testid="route-load-error"]').text()).toMatch(/could not be loaded/i)
  expect(wrapper.get('[data-testid="route-load-error"] a').attributes('href')).toBe('/catalog')
  expect(wrapper.text()).not.toContain('private-request-details')
  await router.push('/deployments')
  await flushPromises()
  expect(wrapper.find('[data-testid="route-load-error"]').exists()).toBe(false)
})
