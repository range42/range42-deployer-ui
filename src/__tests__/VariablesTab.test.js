import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VariablesTab from '@/components/project/VariablesTab.vue'

describe('VariablesTab', () => {
  const base = {
    env: [
      { name: 'ADMIN_USER', scope: 'shared', required: true, default: 'root' },
      { name: 'FLAG_VALUE', scope: 'per_team', required: true, secret: true },
      { name: 'SERVICE_PORT', scope: 'shared', default: 8080 },
    ],
  }

  it('renders one row per declared env var with scope + required markers', () => {
    const wrapper = mount(VariablesTab, { props: { base, overlay: {} } })
    const rows = wrapper.findAll('[data-name]')
    expect(rows.length).toBe(3)
    expect(rows[0].text()).toContain('ADMIN_USER')
    expect(rows[0].text()).toContain('shared')
    expect(rows[1].text()).toContain('per_team')
  })

  it('masks secret values by default and reveals on click', async () => {
    const wrapper = mount(VariablesTab, {
      props: {
        base,
        overlay: { param_overrides: { env: { FLAG_VALUE: 'R42{test}' } } },
      },
    })
    const flagRow = wrapper.find('[data-name="FLAG_VALUE"]')
    expect(flagRow.text()).toContain('••••••••')
    await flagRow.find('button').trigger('click')
    expect(flagRow.text()).toContain('R42{test}')
  })

  it('edits write an override to overlay.param_overrides.env and emit update:overlay', async () => {
    const wrapper = mount(VariablesTab, { props: { base, overlay: {} } })
    const input = wrapper.find('[data-testid="override-ADMIN_USER"]')
    await input.setValue('admin')
    const events = wrapper.emitted('update:overlay') || []
    expect(events.length).toBeGreaterThan(0)
    const last = events[events.length - 1][0]
    expect(last.param_overrides.env.ADMIN_USER).toBe('admin')
  })

  it('clearOverride removes the override from the overlay', async () => {
    const wrapper = mount(VariablesTab, {
      props: {
        base,
        overlay: { param_overrides: { env: { ADMIN_USER: 'admin' } } },
      },
    })
    await wrapper.find('[data-testid="clear-ADMIN_USER"]').trigger('click')
    const events = wrapper.emitted('update:overlay') || []
    const last = events[events.length - 1][0]
    expect(Object.prototype.hasOwnProperty.call(last.param_overrides.env, 'ADMIN_USER')).toBe(false)
  })
})
