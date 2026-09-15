import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VmFields from '@/components/ConfigPanel/VmFields.vue'
import FormField from '@/components/ui/FormField.vue'
import { createScenarioDraft } from '@/services/concreteScenario'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key }) }))

describe('VM clone cloud-init fields', () => {
  it('edits public clone preferences and carries them to a new scenario draft', async () => {
    const config = { name: 'guest', ssh_user: 'operator', dns_servers: '10.42.1.2', dns_search_domain: 'lab.example' }
    const wrapper = mount(VmFields, { props: { modelValue: config } })
    const field = label => wrapper.findAllComponents(FormField).find(field => field.props('label') === label)
    expect(field('Guest SSH user').props('modelValue')).toBe('operator')
    await field('Guest SSH user').get('input').setValue('reviewed')
    await field('DNS servers').get('input').setValue('')
    await field('DNS search domain').get('input').setValue('other.example')
    const draft = createScenarioDraft({ name: 'Demo' }, [{ id: 'vm', type: 'vm', data: { config } }], [])
    expect(draft.vms[0]).toMatchObject({ ssh_user: 'reviewed', dns_servers: '', dns_search_domain: 'other.example' })
    expect(wrapper.text()).toContain('new clones')
    wrapper.unmount()
  })
})
