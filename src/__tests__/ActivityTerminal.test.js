import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import ActivityTerminal from '@/components/project/ActivityTerminal.vue'
import { useActivityLogStore } from '@/stores/activityLogStore'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en: { project: {
    activityTerminal: {
      title: 'Activity', empty: 'No activity yet.', filterAll: 'All',
      filterProxmox: 'Proxmox', filterDeploy: 'Deploy', clear: 'Clear', close: 'Close',
    },
  } } } })
}

describe('ActivityTerminal', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders entries from the store', () => {
    const s = useActivityLogStore()
    s.push({ source: 'proxmox', level: 'success', target: 'vm-1', message: 'deleted' })
    const w = mount(ActivityTerminal, { global: { plugins: [makeI18n()] } })
    expect(w.text()).toContain('deleted')
  })

  it('shows empty state when no entries', () => {
    const w = mount(ActivityTerminal, { global: { plugins: [makeI18n()] } })
    expect(w.text()).toContain('No activity yet.')
  })

  it('filters by source', async () => {
    const s = useActivityLogStore()
    s.push({ source: 'proxmox', level: 'info', target: 'vm-1', message: 'px-line' })
    s.push({ source: 'deploy', level: 'info', target: 'dep-1', message: 'deploy-line' })
    const w = mount(ActivityTerminal, { global: { plugins: [makeI18n()] } })
    await w.find('[data-testid="filter-deploy"]').trigger('click')
    expect(w.text()).toContain('deploy-line')
    expect(w.text()).not.toContain('px-line')
  })

  it('clear empties the log', async () => {
    const s = useActivityLogStore()
    s.push({ source: 'proxmox', level: 'info', target: 'x', message: 'gone-soon' })
    const w = mount(ActivityTerminal, { global: { plugins: [makeI18n()] } })
    await w.find('[data-testid="activity-clear"]').trigger('click')
    expect(s.entries).toHaveLength(0)
  })
})
