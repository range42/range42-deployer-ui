import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PlatformStackModal from '@/components/project/PlatformStackModal.vue'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/services/backendApi', () => ({ backendRequest: request, getBackendScope: () => 'fixture' }))
it('requires a review before adding and invalidates it when stack settings change', async () => {
  request.mockResolvedValue({ version: 1, plan: { id: 'alpha', domain: 'alpha.example.test', profile: 'core', bridge: 'r42alpha', subnet: '10.81.0.0/24', vms: [{ vm_id: 31000, vm_name: 'r42-alpha-ui', service: 'ui' }] }, scenario: { version: 1, path: 'platforms/alpha' }, files: {} })
  const wrapper = mount(PlatformStackModal, { props: { project: { id: 'p', name: 'Lab', nodes: [], edges: [], attachments: [] } }, global: { stubs: { FocusTrap: { template: '<div><slot /></div>' } } } })
  try {
    expect(wrapper.find('[data-testid="platform-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="platform-add"]').exists()).toBe(false)
    await wrapper.get('[name="id"]').setValue('alpha')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(request).toHaveBeenCalledWith('/v1/platform/components/preview', expect.objectContaining({ method: 'POST' }))
    expect(wrapper.get('[data-testid="platform-add"]').text()).toBe('Add stack to project')
    await wrapper.get('[name="domain"]').setValue('new.example.test')
    expect(wrapper.find('[data-testid="platform-add"]').exists()).toBe(false)
    expect(wrapper.emitted('add')).toBeUndefined()
  } finally { wrapper.unmount() }
})
