import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import EdgeConfigPanel from '@/components/EdgeConfigPanel.vue'
import configPanel from '@/locales/en/configPanel.json'

function mountPanel(props) {
  return mount(EdgeConfigPanel, { props, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { configPanel } } })] } })
}

describe('connection text editing', () => {
  it('edits an annotation without creating network interface configuration', async () => {
    const wrapper = mountPanel({ edge: { id: 'link', source: 'note', target: 'vm', label: 'Review' }, sourceNode: { type: 'note' }, targetNode: { type: 'vm' } })
    expect(wrapper.find('textarea').exists()).toBe(true)
    await wrapper.get('textarea').setValue('Review this connection')
    expect(wrapper.emitted('update')).toEqual([['link', { label: 'Review this connection' }]])
    expect(wrapper.text()).not.toContain('Interface Name')
  })

  it('preserves custom text when editing a network interface and does not write on edge selection', async () => {
    const edge = { id: 'link', source: 'vm', target: 'net', label: 'Service traffic', data: { connection: { interfaceName: 'net0', ipAddress: '10.10.0.10/24' } } }
    const wrapper = mountPanel({ edge, sourceNode: { type: 'vm' }, targetNode: { type: 'network-segment' } })
    await wrapper.get('input[placeholder="e.g., net0, eth0, WAN"]').setValue('eth0')
    expect(wrapper.emitted('update').at(-1)[1]).not.toHaveProperty('label')
    expect(wrapper.get('textarea').element.value).toBe('Service traffic')
    const before = wrapper.emitted('update').length
    await wrapper.setProps({ edge: { id: 'other', source: 'vm', target: 'net', label: 'Other traffic', data: { connection: { interfaceName: 'net1' } } } })
    expect(wrapper.emitted('update')).toHaveLength(before)
    expect(wrapper.get('textarea').element.value).toBe('Other traffic')
  })
})

it('inspects stack connection addresses without changing their deployment configuration', async () => {
  const w = mountPanel({ edge: { id: 'e', data: { connection: { ipAddress: '10.81.0.12/24' } } }, sourceNode: { type: 'vm', data: { config: { platformStack: 'platform-alpha' } } }, targetNode: { type: 'network-segment' } })
  expect(w.get('fieldset').attributes('disabled')).toBeDefined()
  await w.vm.updateConnection()
  expect(w.emitted('update')).toBeUndefined()
})


it.each([false, true])('labels managed connections for their owning component (native: %s)', async nativeScenario => {
  const w = mountPanel({ edge: { id: 'e' }, sourceNode: { type: 'network-segment' }, targetNode: { type: 'vm', data: { config: { platformStack: 'component', nativeScenario } } } })
  expect(w.text()).toContain(nativeScenario ? 'Configured by its scenario.' : 'Configured by the Range42 stack.')
  const button = w.get('button.link')
  expect(button.text()).toBe(nativeScenario ? 'Scenario source' : 'Stack files')
  await button.trigger('click')
  expect(w.emitted('open-stack-files')).toHaveLength(1)
})


it('omits the source action when no repository browser is available', () => {
  const w = mountPanel({ edge: { id: 'e' }, canOpenStackFiles: false, sourceNode: { type: 'vm', data: { config: { platformStack: 'component', nativeScenario: true } } } })
  expect(w.text()).toContain('Configured by its scenario.')
  expect(w.find('button.link').exists()).toBe(false)
})
