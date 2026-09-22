import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import InfraNodeNetwork from '@/components/nodes/InfraNodeNetwork.vue'
import configPanel from '@/locales/en/configPanel.json'

vi.mock('@vue-flow/core', () => ({
  Handle: { props: ['id', 'type'], template: '<i :data-handle="id" :data-type="type" />' },
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  useVueFlow: () => ({
    getEdges: { value: [{ source: 'net', target: 'vm' }, { source: 'vm', target: 'net' },
      { source: 'net', target: 'note' }, { source: 'net', target: 'ref', data: { reference_only: true } }] },
    findNode: (id: string) => ({ id, type: id === 'note' ? 'note' : 'vm' }),
  }),
}))

describe('network card', () => {
  it('counts unique devices, displays configured addressing, and supports connections in both directions', () => {
    const wrapper = mount(InfraNodeNetwork, { props: { id: 'net', data: { config: {
      name: 'Service network', segmentType: 'dmz', cidr: '10.10.20.0/24', bridge: 'vmbr20', vlan: 20, gateway: '10.10.20.1',
    } } }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { configPanel } } })] } })
    expect(wrapper.text()).toContain('1 device connected')
    for (const text of ['Service network', '10.10.20.0/24', 'vmbr20', '20', '10.10.20.1']) expect(wrapper.text()).toContain(text)
    expect(wrapper.find('[data-type="source"]').exists()).toBe(true)
    for (const id of ['top-1', 'top-2', 'top-3', 'bottom-1', 'bottom-2', 'bottom-3', 'left-1', 'left-2', 'right-1', 'right-2']) {
      expect(wrapper.find(`[data-handle="${id}"]`).exists()).toBe(true)
    }
  })
})
