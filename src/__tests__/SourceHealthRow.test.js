import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import SourceHealthRow from '@/components/ui/SourceHealthRow.vue'
import sourcesEn from '@/locales/en/sources.json'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { sources: sourcesEn } },
  })
}

function baseSource(overrides = {}) {
  return {
    id: 'gitlab:acme/catalog',
    provider: 'gitlab',
    base_url: 'https://gl.example',
    name: 'acme/catalog',
    auth: { kind: 'none' },
    repos: [],
    ...overrides,
  }
}

function mountRow(props) {
  return mount(SourceHealthRow, {
    props,
    global: { plugins: [makeI18n()] },
  })
}

describe('<SourceHealthRow> write-access badge', () => {
  it('shows a "Writable" badge when the source is writable', () => {
    const wrapper = mountRow({
      source: baseSource({ writable: true }),
      health: { status: 'ok' },
    })
    const badge = wrapper.find('[data-testid="source-access-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe(sourcesEn.access_writable)
  })

  it('shows a "Read-only" badge when the source is read-only', () => {
    const wrapper = mountRow({
      source: baseSource({ writable: false }),
      health: { status: 'ok' },
    })
    const badge = wrapper.find('[data-testid="source-access-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe(sourcesEn.access_readonly)
  })

  it('reads writability from health.writable when source flag is absent', () => {
    const wrapper = mountRow({
      source: baseSource(),
      health: { status: 'ok', writable: false },
    })
    const badge = wrapper.find('[data-testid="source-access-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe(sourcesEn.access_readonly)
  })

  it('renders no access badge when write access is unknown', () => {
    const wrapper = mountRow({
      source: baseSource(),
      health: { status: 'unknown' },
    })
    expect(wrapper.find('[data-testid="source-access-badge"]').exists()).toBe(false)
  })
})
