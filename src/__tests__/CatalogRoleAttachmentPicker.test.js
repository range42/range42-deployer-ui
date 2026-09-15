import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CatalogRoleAttachmentPicker from '@/components/project/CatalogRoleAttachmentPicker.vue'
import { useProjectStore } from '@/stores/projectStore'
import fixture from './fixtures/catalogRoleNtp.json'

enableAutoUnmount(afterEach)
const origin = { version: 1, kind: 'ansible_role', mode: 'customize', source_id: 'catalog', provider: 'github',
  base_url: 'https://github.com', repo_owner: 'range42', repo_name: 'catalog', path: fixture.path, sha: fixture.sha }
function setup() {
  const pinia = createPinia(); setActivePinia(pinia)
  const store = useProjectStore()
  store.projects.push({ id: 'role', name: 'NTP role', catalogRef: origin, files: structuredClone(fixture.files) })
  const project = { id: 'scenario', files: {} }
  const wrapper = mount(CatalogRoleAttachmentPicker, { props: { open: true, project,
    vms: [{ node_id: 'vm1', vm_name: 'First' }, { node_id: 'vm2', vm_name: 'Second' }] },
  global: { plugins: [pinia], stubs: { teleport: true, FocusTrap: { template: '<div><slot /></div>' } } } })
  return { wrapper, store, project }
}
describe('catalog role attachment review', () => {
  it('reviews the actual local files and selected target before emitting a staged copy', async () => {
    const { wrapper, project } = setup()
    await wrapper.get('[data-testid="role-target"]').setValue('vm2')
    await wrapper.get('[data-testid="role-review"]').trigger('click')
    expect(wrapper.get('[data-testid="role-review-summary"]').text()).toContain('7')
    expect(wrapper.text()).toContain(fixture.sha)
    expect(wrapper.emitted('selected')).toBeUndefined()
    expect(project.files).toEqual({})
    await wrapper.get('[data-testid="role-attach"]').trigger('click')
    expect(wrapper.emitted('selected')[0][0].item.target_node).toBe('vm2')
    expect(wrapper.emitted('selected')[0][0].files).toEqual(fixture.files)
    expect(project.files).toEqual({})
  })
  it('cancels without saving and invalidates review after source or target changes', async () => {
    const { wrapper, store } = setup()
    await wrapper.get('[data-testid="role-review"]').trigger('click')
    store.projects[0].files[`${fixture.path}/tasks/main.yml`] += '\n# changed\n'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="role-attach"]').exists()).toBe(false)
    await wrapper.get('[data-testid="role-review"]').trigger('click')
    await wrapper.get('[data-testid="role-target"]').setValue('vm2')
    expect(wrapper.find('[data-testid="role-attach"]').exists()).toBe(false)
    await wrapper.get('[data-testid="role-cancel"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('selected')).toBeUndefined()
  })
  it('keeps a collision actionable and allows re-review of an already copied role after editing', async () => {
    const { wrapper, project } = setup()
    await wrapper.setProps({ project: { ...project, files: { [`${fixture.path}/tasks/main.yml`]: 'manual' } } })
    await wrapper.get('[data-testid="role-review"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('already exists')
    const files = structuredClone(fixture.files); files[`${fixture.path}/tasks/main.yml`] += '\n# edited\n'
    await wrapper.setProps({ project: { ...project, files }, existingItem: { id: 'attached', path: fixture.path,
      target_node: 'vm2', role: { origin } } })
    await wrapper.get('[data-testid="role-review"]').trigger('click')
    await wrapper.get('[data-testid="role-attach"]').trigger('click')
    expect(wrapper.emitted('selected')[0][0]).toMatchObject({ files, item: { id: 'attached', target_node: 'vm2' } })
  })
})
