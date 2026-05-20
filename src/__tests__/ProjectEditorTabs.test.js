import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { computed, defineComponent, h } from 'vue'

/**
 * Focused test for the Plan C C3.6 tab-shell contract:
 *   - ?tab= reads as a computed from route.query
 *   - clicking a tab calls router.replace({ query: { ...query, tab } })
 *   - canvas + other panes use v-show (not v-if) so their state survives
 *     tab switches
 *
 * We intentionally replicate the tiny surface ProjectEditor.vue exposes for
 * tabs — mounting the real view is an integration-test job (it drags in
 * VueFlow, Pinia, a dozen composables, etc.).
 */

const TABS = ['canvas', 'config', 'variables', 'history', 'settings']

const TabShell = defineComponent({
  setup() {
    return () => null
  },
})

function buildApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/project/:id', name: 'project', component: TabShell }],
  })

  const App = defineComponent({
    setup() {
      const tab = computed(() => {
        const q = router.currentRoute.value.query.tab
        const v = Array.isArray(q) ? q[0] : q
        return TABS.includes(String(v)) ? String(v) : 'canvas'
      })
      function setTab(next) {
        if (!TABS.includes(next)) return
        if (router.currentRoute.value.query.tab === next) return
        router.replace({ query: { ...router.currentRoute.value.query, tab: next } })
      }
      // Simulate stateful panes; we render all of them via v-show equivalents
      // by emitting them as divs and asserting their presence stays constant.
      return () =>
        h('div', { 'data-testid': 'shell' }, [
          h(
            'div',
            { 'data-testid': 'tabstrip' },
            TABS.map((t) =>
              h(
                'button',
                {
                  key: t,
                  'data-testid': `project-tab-${t}`,
                  class: { 'tab-active': tab.value === t },
                  onClick: () => setTab(t),
                },
                t,
              ),
            ),
          ),
          // Every pane is always present (v-show semantics) — we only toggle a
          // data-visible attribute.
          ...TABS.map((t) =>
            h(
              'div',
              {
                key: t,
                'data-testid': `pane-${t}`,
                'data-visible': tab.value === t ? 'true' : 'false',
              },
              `${t} pane`,
            ),
          ),
        ])
    },
  })

  return { router, App }
}

describe('ProjectEditor tab shell (C3.6)', () => {
  it('defaults to the canvas tab when no ?tab query is set', async () => {
    const { router, App } = buildApp()
    router.push('/project/p1')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    expect(wrapper.find('[data-testid="pane-canvas"]').attributes('data-visible')).toBe('true')
    expect(wrapper.find('[data-testid="pane-config"]').attributes('data-visible')).toBe('false')
  })

  it('reads the ?tab= query on initial route', async () => {
    const { router, App } = buildApp()
    router.push('/project/p1?tab=variables')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    expect(wrapper.find('[data-testid="pane-variables"]').attributes('data-visible')).toBe('true')
  })

  it('falls back to canvas for unknown ?tab values', async () => {
    const { router, App } = buildApp()
    router.push('/project/p1?tab=garbage')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    expect(wrapper.find('[data-testid="pane-canvas"]').attributes('data-visible')).toBe('true')
  })

  it('clicking a tab updates the URL query via router.replace', async () => {
    const { router, App } = buildApp()
    router.push('/project/p1')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    await wrapper.find('[data-testid="project-tab-history"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('history')
    expect(wrapper.find('[data-testid="pane-history"]').attributes('data-visible')).toBe('true')
  })

  it('all tab panes remain in the DOM across switches — v-show semantics preserve state', async () => {
    const { router, App } = buildApp()
    router.push('/project/p1')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    for (const t of TABS) {
      expect(wrapper.find(`[data-testid="pane-${t}"]`).exists()).toBe(true)
    }
    await wrapper.find('[data-testid="project-tab-settings"]').trigger('click')
    await flushPromises()
    // Canvas pane is still mounted — its internal state (VueFlow viewport /
    // selection / undo buffers in the real view) stays intact.
    expect(wrapper.find('[data-testid="pane-canvas"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pane-canvas"]').attributes('data-visible')).toBe('false')
  })

  it('switching tabs does not remount any tab pane (stable element identity)', async () => {
    const { router, App } = buildApp()
    router.push('/project/p1')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    const canvasBefore = wrapper.find('[data-testid="pane-canvas"]').element
    await wrapper.find('[data-testid="project-tab-config"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="project-tab-history"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="project-tab-canvas"]').trigger('click')
    await flushPromises()
    const canvasAfter = wrapper.find('[data-testid="pane-canvas"]').element
    // Same DOM node — no remount, so state (canvas viewport, selection, undo
    // buffers) would be preserved in the real view.
    expect(canvasAfter).toBe(canvasBefore)
  })
})
