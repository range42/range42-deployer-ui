import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import InlineYamlForm from '@/components/project/attachments/sources/InlineYamlForm.vue'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackWarn: false,
    missingWarn: false,
    messages: { en: {} },
  })
}

describe('InlineYamlForm', () => {
  it('renders textarea with value from source.content_inline', () => {
    const wrapper = mount(InlineYamlForm, {
      props: { source: { kind: 'inline_yaml', content_inline: 'a: 1\n' } },
      global: { plugins: [makeI18n()] },
    })
    const ta = wrapper.find('[data-testid="inline-yaml"]')
    expect(ta.exists()).toBe(true)
    expect(ta.element.value).toBe('a: 1\n')
  })

  it('emits update:source with merged content_inline on input', async () => {
    const source = { kind: 'inline_yaml', content_inline: 'a: 1\n' }
    const wrapper = mount(InlineYamlForm, {
      props: { source },
      global: { plugins: [makeI18n()] },
    })
    const ta = wrapper.find('[data-testid="inline-yaml"]')
    ta.element.value = 'b: 2\n'
    await ta.trigger('input')
    const emitted = wrapper.emitted('update:source')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual({ kind: 'inline_yaml', content_inline: 'b: 2\n' })
  })

  it('does not mutate the original prop object', async () => {
    const source = { kind: 'inline_yaml', content_inline: 'a: 1\n' }
    const wrapper = mount(InlineYamlForm, {
      props: { source },
      global: { plugins: [makeI18n()] },
    })
    const ta = wrapper.find('[data-testid="inline-yaml"]')
    ta.element.value = 'mutated\n'
    await ta.trigger('input')
    expect(source.content_inline).toBe('a: 1\n')
  })
})
