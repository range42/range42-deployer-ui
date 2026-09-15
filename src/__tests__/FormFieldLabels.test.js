import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import FormField from '@/components/ui/FormField.vue'
enableAutoUnmount(afterEach)

describe('FormField accessible labels', () => {
  it.each(['text', 'number', 'textarea', 'select', 'checkbox'])('associates the visible %s label with its own control', type => {
    const wrapper = mount(FormField, { attachTo: document.body, props: { type, label: 'Resource setting', hint: 'Helpful instructions', options: [] } })
    const input = wrapper.get('input, textarea, select').element
    expect(Array.from(input.labels || []).some(label => label.textContent.includes('Resource setting'))).toBe(true)
    if (type !== 'checkbox') {
      expect(input.getAttribute('aria-labelledby')).toBeTruthy()
      expect(document.getElementById(input.getAttribute('aria-labelledby')).textContent.trim()).toBe('Resource setting')
    }
  })
  it('gives repeated fields unique IDs within one form', () => {
    const wrapper = mount({ components: { FormField }, template: '<form><FormField label="Memory"/><FormField label="Memory"/></form>' })
    const ids = wrapper.findAll('input').map(input => input.attributes('id'))
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })
})
