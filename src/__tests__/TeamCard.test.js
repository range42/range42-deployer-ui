import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TeamCard from '@/components/ui/TeamCard.vue'
import deploymentEn from '@/locales/en/deployment.json'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { deployment: deploymentEn } },
  })
}

function baseTeam(overrides = {}) {
  return {
    id: 'team-1',
    status: 'deploying',
    latest_logs: [
      { ts: '2026-04-14T10:00:00Z', stream: 'stdout', text: 'hello' },
      { ts: '2026-04-14T10:00:01Z', stream: 'stdout', text: 'world' },
      { ts: '2026-04-14T10:00:02Z', stream: 'stderr', text: 'oh no' },
    ],
    snapshots: [],
    ...overrides,
  }
}

describe('<TeamCard>', () => {
  it('renders team id and status badge', () => {
    const wrapper = mount(TeamCard, {
      props: { team: baseTeam() },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).toContain('team-1')
    expect(wrapper.text()).toContain('deploying')
  })

  it('renders last 3 log lines (most recent)', () => {
    const wrapper = mount(TeamCard, {
      props: {
        team: baseTeam({
          latest_logs: Array.from({ length: 5 }, (_, i) => ({
            ts: 't', stream: 'stdout', text: `line-${i}`,
          })),
        }),
      },
      global: { plugins: [makeI18n()] },
    })
    const text = wrapper.text()
    expect(text).toContain('line-2')
    expect(text).toContain('line-3')
    expect(text).toContain('line-4')
    expect(text).not.toContain('line-0')
  })

  it('emits open-logs with team id when log strip clicked', async () => {
    const wrapper = mount(TeamCard, {
      props: { team: baseTeam() },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('button[aria-label="Open logs for this team"]').trigger('click')
    const emitted = wrapper.emitted('open-logs')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual({ teamId: 'team-1' })
  })

  it('shows queued pill when queued_reset=true', () => {
    const wrapper = mount(TeamCard, {
      props: { team: baseTeam({ queued_reset: true }) },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="team-card-queued"]').exists()).toBe(true)
  })

  it('opens action menu and emits reset', async () => {
    const wrapper = mount(TeamCard, {
      props: { team: baseTeam() },
      global: { plugins: [makeI18n()] },
    })
    const menuBtn = wrapper.find('button[aria-label="Team actions"]')
    await menuBtn.trigger('click')
    const resetBtn = wrapper.findAll('[role="menuitem"]').find(b => b.text() === 'Reset team')
    expect(resetBtn).toBeTruthy()
    await resetBtn.trigger('click')
    expect(wrapper.emitted('reset')[0][0]).toEqual({ teamId: 'team-1' })
  })

  it('copy-ssh writes to clipboard and emits', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const originalNavigator = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { ...originalNavigator, clipboard: { writeText } },
    })
    const wrapper = mount(TeamCard, {
      props: { team: baseTeam({ ssh_command: 'ssh user@host' }) },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('button[aria-label="Team actions"]').trigger('click')
    const copyBtn = wrapper.findAll('[role="menuitem"]').find(b => b.text() === 'Copy SSH command')
    await copyBtn.trigger('click')
    expect(writeText).toHaveBeenCalledWith('ssh user@host')
    expect(wrapper.emitted('copy-ssh')).toBeTruthy()
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    })
  })
})


it('hides unsupported deployment actions when disabled by the scenario', () => {
  const wrapper = mount(TeamCard, {
    props: { team: baseTeam(), actionsEnabled: false },
    global: { plugins: [makeI18n()] },
  })
  expect(wrapper.find('button[aria-label="Team actions"]').exists()).toBe(false)
})
