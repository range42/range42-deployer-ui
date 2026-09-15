import { afterEach, beforeEach, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import Sidebar from '@/components/Sidebar.vue'
import { i18n, ensureNamespaces, setLocale } from '@/i18n'

enableAutoUnmount(afterEach)
beforeEach(async () => { localStorage.clear(); await setLocale('en', ['sidebar', 'common']); await ensureNamespaces(['sidebar']) })

async function shell(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    '/', '/catalog', '/catalog/:source/:entry', '/project/:id', '/deployments',
    '/deployments/:id', '/deployments/:id/preflight', '/sources', '/settings',
  ].map(path => ({ path, component: { template: '<h1>Page content</h1>' } })) })
  await router.push(path)
  const wrapper = mount(AppShell, { global: { plugins: [router, createPinia(), i18n],
    stubs: { BackendAccessPanel: true, LegacyStorageBanner: true } } })
  await flushPromises()
  return { wrapper, router }
}

it('labels primary destinations instead of displaying their initials', async () => {
  const { wrapper } = await shell()
  const links = wrapper.get('nav[aria-label="Primary"]').findAll('a')
  expect(links.map(link => link.text())).toEqual(['Projects', 'Catalog', 'Deployments', 'Sources', 'Settings'])
})

it.each([['/project/example', '/'], ['/catalog/source/entry', '/catalog'], ['/deployments/run/preflight', '/deployments']])('marks the owning section for %s', async (path, href) => {
  const { wrapper } = await shell(path)
  const active = wrapper.get('nav[aria-label="Primary"]').findAll('a[aria-current]')
  expect(active).toHaveLength(1)
  expect(active[0].attributes('href')).toBe(href)
})

it('does not navigate or prevent browser keys when former shortcuts are pressed', async () => {
  const { router } = await shell('/sources')
  for (const key of ['v', 'c', 'n', 'r', 'f', 'g']) {
    for (const ctrlKey of [false, true]) {
      const event = new KeyboardEvent('keydown', { key, ctrlKey, cancelable: true })
      window.dispatchEvent(event)
      await flushPromises()
      expect(event.defaultPrevented).toBe(false)
      expect(router.currentRoute.value.path).toBe('/sources')
    }
  }
})

it('preserves the chosen sidebar width across navigation and reload', async () => {
  const { wrapper, router } = await shell()
  await wrapper.get('button[aria-label="Collapse sidebar"]').trigger('click')
  await router.push('/project/example')
  expect(wrapper.get('button[aria-label="Expand sidebar"]').attributes('aria-expanded')).toBe('false')
  wrapper.unmount()
  const reloaded = await shell()
  expect(reloaded.wrapper.get('button[aria-label="Expand sidebar"]').attributes('aria-expanded')).toBe('false')
})

it('provides a skip link targeting focusable main content', async () => {
  const { wrapper } = await shell()
  expect(wrapper.get('a[href="#main-content"]').text()).toBe('Skip to content')
  expect(wrapper.get('main#main-content').attributes('tabindex')).toBe('-1')
})

it('offers a real component button without misleading shortcut badges', async () => {
  const wrapper = mount(Sidebar, { props: { project: { name: 'Lab', nodes: [], edges: [] } }, global: { plugins: [createPinia(), i18n] } })
  await flushPromises()
  expect(wrapper.find('kbd').exists()).toBe(false)
  await wrapper.get('button[aria-label="Add virtual machine"]').trigger('click')
  expect(wrapper.emitted('addComponent')).toEqual([['vm']])
})

it('exposes project section state and labels the language control', async () => {
  const wrapper = mount(Sidebar, { props: { project: { name: 'Lab' } }, global: { plugins: [createPinia(), i18n] } })
  await flushPromises()
  const toggle = wrapper.get('button[aria-controls$="-components"]')
  expect(toggle.attributes('aria-expanded')).toBe('true')
  await toggle.trigger('click')
  expect(toggle.attributes('aria-expanded')).toBe('false')
  expect(wrapper.get(`[id="${toggle.attributes('aria-controls')}"]`).isVisible()).toBe(false)
  expect(wrapper.get('select').attributes('aria-label')).toBe('Language')
})
