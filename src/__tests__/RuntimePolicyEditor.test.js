import { afterEach, describe, expect, it } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import RuntimePolicyEditor from '@/components/deployment/RuntimePolicyEditor.vue'
import runtime from '@/locales/en/runtime.json'

enableAutoUnmount(afterEach)
const chains = () => [{ scope: 'vm', vm_id: 3191, available: true,
  rules: [{ position: 0, direction: 'in', action: 'ACCEPT', protocol: 'tcp', destination_port: '443', enabled: true,
    source: '10.42.70.0/24', comment: 'range42-deployment:dep;rule:web' },
  { position: 1, direction: 'in', action: 'ACCEPT', protocol: 'tcp', destination_port: '22', enabled: true, comment: 'Management access' }],
  aliases: [{ name: 'clients', cidr: '10.42.70.0/24', comment: 'range42-deployment:dep' },
    { name: 'foreign', cidr: '10.90.0.0/24', comment: 'Someone else' }] }]
function show(props = {}) {
  return mount(RuntimePolicyEditor, { props: { deploymentId: 'dep', chains: chains(), ...props }, global: {
    plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { runtime } } })],
  } })
}
describe('reviewed policy editor', () => {
  it.each(['replacement', 'changed settings', 'removed'])('preserves the draft but refuses a stale rule after %s', async change => {
    const wrapper = show()
    await wrapper.get('[data-testid="policy-edit-vm-3191-0"]').trigger('click')
    await wrapper.get('[data-testid="policy-port"]').setValue('8443')
    const updated = chains()
    if (change === 'replacement') updated[0].rules[0].comment = 'range42-deployment:dep;rule:other'
    if (change === 'changed settings') updated[0].rules[0].source = '10.42.80.0/24'
    if (change === 'removed') updated[0].rules = []
    await wrapper.setProps({ chains: updated })
    await wrapper.get('[data-testid="policy-rule-form"]').trigger('submit')
    expect(wrapper.emitted('review')).toBeUndefined()
    expect(wrapper.get('[data-testid="policy-port"]').element.value).toBe('8443')
    expect(wrapper.get('[data-testid="policy-rule-form"] [role="alert"]').text()).toContain('changed')
  })
  it('allows an unchanged rule draft after refreshing and explicitly reselecting a changed rule', async () => {
    const wrapper = show()
    await wrapper.get('[data-testid="policy-edit-vm-3191-0"]').trigger('click')
    await wrapper.get('[data-testid="policy-port"]').setValue('8443')
    await wrapper.setProps({ chains: chains() })
    await wrapper.get('[data-testid="policy-rule-form"]').trigger('submit')
    expect(wrapper.emitted('review')).toHaveLength(1)
    const updated = chains()
    updated[0].rules[0].destination_port = '9443'
    await wrapper.setProps({ chains: updated })
    await wrapper.get('[data-testid="policy-edit-vm-3191-0"]').trigger('click')
    await wrapper.get('[data-testid="policy-rule-form"]').trigger('submit')
    expect(wrapper.emitted('review')[1][0].rule.destination_port).toBe('9443')
  })
  it('keeps a rename draft but refuses to rename an alias changed since selection', async () => {
    const wrapper = show()
    await wrapper.get('[data-testid="alias-rename-vm-3191-clients"]').trigger('click')
    await wrapper.get('[data-testid="alias-new-name"]').setValue('students')
    const updated = chains()
    updated[0].aliases[0].cidr = '10.42.80.0/24'
    await wrapper.setProps({ chains: updated })
    await wrapper.get('[data-testid="policy-alias-form"]').trigger('submit')
    expect(wrapper.emitted('review')).toBeUndefined()
    expect(wrapper.get('[data-testid="alias-new-name"]').element.value).toBe('students')
    expect(wrapper.get('[data-testid="policy-alias-form"] [role="alert"]').text()).toContain('changed')
  })
  it('prepares a complete guest rule edit and preserves source restrictions', async () => {
    const wrapper = show()
    await wrapper.get('[data-testid="policy-edit-vm-3191-0"]').trigger('click')
    expect(wrapper.get('[data-testid="policy-source"]').element.value).toBe('10.42.70.0/24')
    await wrapper.get('[data-testid="policy-port"]').setValue('8443')
    await wrapper.get('[data-testid="policy-rule-form"]').trigger('submit')
    expect(wrapper.emitted('review')[0][0]).toEqual({ kind: 'firewall_rule', scope: 'vm', vm_id: 3191, action: 'update', position: 0,
      rule: { direction: 'in', action: 'ACCEPT', protocol: 'tcp', destination_port: '8443', source: '10.42.70.0/24', destination: null, enabled: true } })
  })
  it('reviews rule order changes by their final position', async () => {
    const wrapper = show()
    await wrapper.get('[data-testid="policy-down-vm-3191-0"]').trigger('click')
    expect(wrapper.emitted('review')[0][0]).toEqual({ kind: 'firewall_rule', scope: 'vm', vm_id: 3191, action: 'move', position: 0, move_to: 1 })
  })
  it('offers rename only for owned aliases and never invents a node alias scope', async () => {
    const wrapper = show({ chains: [...chains(), { scope: 'node', available: true, rules: [], aliases: [] }] })
    expect(wrapper.find('[data-testid="alias-delete-vm-3191-foreign"]').exists()).toBe(false)
    await wrapper.get('[data-testid="alias-rename-vm-3191-clients"]').trigger('click')
    await wrapper.get('[data-testid="alias-new-name"]').setValue('students')
    await wrapper.get('[data-testid="policy-alias-form"]').trigger('submit')
    expect(wrapper.emitted('review')[0][0]).toEqual({ kind: 'firewall_alias', scope: 'vm', vm_id: 3191, action: 'rename', name: 'clients', new_name: 'students' })
  })
  it('keeps unreadable scopes and protected management rules unavailable', () => {
    const wrapper = show()
    expect(wrapper.find('[data-testid="policy-edit-vm-3191-1"]').exists()).toBe(false)
    const unreadable = show({ chains: [{ scope: 'vm', vm_id: 3191, available: false, rules: [], aliases: [] }] })
    expect(unreadable.find('[data-testid="policy-rule-form"]').exists()).toBe(false)
  })
  it('protects outbound allow rules that may carry management replies', () => {
    const values = chains()
    values[0].rules[0].direction = 'out'
    values[0].rules[0].destination_port = '1024:65535'
    const wrapper = show({ chains: values })
    expect(wrapper.find('[data-testid="policy-edit-vm-3191-0"]').exists()).toBe(false)
  })
})
