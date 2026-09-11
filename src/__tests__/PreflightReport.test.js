import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import PreflightReport from '@/components/ui/PreflightReport.vue'
import deploymentEn from '@/locales/en/deployment.json'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { deployment: deploymentEn } },
  })
}

function baseRecord(overrides = {}) {
  return {
    checks: [
      { check: 'vmid_free', result: 'pass', detail: 'all in range' },
      { check: 'ip_conflict', result: 'warn', detail: 'overlap on 10.0.0.0/24' },
      { check: 'git_source_reachable', result: 'block', detail: 'DNS failed' },
    ],
    ok: false,
    blocking: true,
    generated_at: '2026-04-14T10:00:00Z',
    attempt_id: 'att-7',
    ...overrides,
  }
}

describe('<PreflightReport>', () => {
  it('groups checks by inferred category in fixed order', () => {
    const wrapper = mount(PreflightReport, {
      props: { record: baseRecord() },
      global: { plugins: [makeI18n()] },
    })
    // Category headings: VMIDs first, then IPs, then Git
    const headings = wrapper.findAll('.card-title').map(h => h.text())
    expect(headings).toEqual(['VMIDs', 'IPs', 'Git sources'])
  })

  it('renders all checks as rows', () => {
    const wrapper = mount(PreflightReport, {
      props: { record: baseRecord() },
      global: { plugins: [makeI18n()] },
    })
    const rows = wrapper.findAll('[data-testid="preflight-check-row"]')
    expect(rows.length).toBe(3)
  })

  it('shows blocking banner when record.blocking=true', () => {
    const wrapper = mount(PreflightReport, {
      props: { record: baseRecord() },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('.alert-error').exists()).toBe(true)
    expect(wrapper.text()).toContain('Blocking issues found')
  })

  it('shows OK banner when checks all pass', () => {
    const wrapper = mount(PreflightReport, {
      props: {
        record: {
          checks: [{ check: 'vmid_free', result: 'pass' }],
          ok: true,
          blocking: false,
          generated_at: '2026-04-14T10:00:00Z',
        },
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('.alert-success').exists()).toBe(true)
  })

  it('renders correct result badge class per row', () => {
    const wrapper = mount(PreflightReport, {
      props: { record: baseRecord() },
      global: { plugins: [makeI18n()] },
    })
    const rows = wrapper.findAll('[data-testid="preflight-check-row"]')
    expect(rows[0].find('.badge-success').exists()).toBe(true) // pass
    expect(rows[1].find('.badge-warning').exists()).toBe(true) // warn
    expect(rows[2].find('.badge-error').exists()).toBe(true)   // block
  })

  it('renders empty-state message when no checks', () => {
    const wrapper = mount(PreflightReport, {
      props: {
        record: { checks: [], ok: true, blocking: false, generated_at: 't' },
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).toContain('has no checks')
  })
})

it.each([
  ['pass', 'All checks passed', 'alert-success'],
  ['block', 'Blocking issues found', 'alert-error'],
])('renders canonical preflight result %s and timestamp', (result, label, cls) => {
  const wrapper = mount(PreflightReport, {
    props: { record: { result, checks: [], ts: '2026-09-10T10:00:00Z' } },
    global: { plugins: [makeI18n()] },
  })
  expect(wrapper.text()).toContain(label)
  expect(wrapper.find(`.${cls}`).exists()).toBe(true)
  expect(wrapper.text()).toContain('2026-09-10T10:00:00Z')
})
