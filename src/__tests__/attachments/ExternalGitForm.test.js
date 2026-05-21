import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ExternalGitForm from '@/components/project/attachments/sources/ExternalGitForm.vue'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackWarn: false,
    missingWarn: false,
    messages: { en: {} },
  })
}

describe('ExternalGitForm', () => {
  const baseSource = {
    kind: 'external_git',
    url: 'https://x/y.git',
    sha: 'abc',
    ref: 'sub/dir',
  }

  it('reflects source values in the three inputs', () => {
    const wrapper = mount(ExternalGitForm, {
      props: { source: baseSource },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="git-url"]').element.value).toBe('https://x/y.git')
    expect(wrapper.find('[data-testid="git-sha"]').element.value).toBe('abc')
    expect(wrapper.find('[data-testid="git-ref"]').element.value).toBe('sub/dir')
  })

  it('emits update:source with new url and preserves other fields', async () => {
    const source = { ...baseSource }
    const wrapper = mount(ExternalGitForm, {
      props: { source },
      global: { plugins: [makeI18n()] },
    })
    const urlInput = wrapper.find('[data-testid="git-url"]')
    urlInput.element.value = 'https://new/repo.git'
    await urlInput.trigger('input')
    const emitted = wrapper.emitted('update:source')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual({
      kind: 'external_git',
      url: 'https://new/repo.git',
      sha: 'abc',
      ref: 'sub/dir',
    })
  })

  it('shows the security note element', () => {
    const wrapper = mount(ExternalGitForm, {
      props: { source: baseSource },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="git-security-note"]').exists()).toBe(true)
  })
})
