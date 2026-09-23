import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import NewRoleModal from '@/components/catalog/NewRoleModal.vue'

enableAutoUnmount(afterEach)

function mountModal(props = {}) {
  return mount(NewRoleModal, {
    props: { open: true, ...props },
    global: { plugins: [createI18n({ legacy: false, locale: 'en' })] },
  })
}

async function fillRole(wrapper) {
  await wrapper.get('[name="target"]').setValue('example')
  await wrapper.get('[name="description"]').setValue('Install the example service')
  await wrapper.get('[name="tasks"]').setValue('- name: Install example\n  ansible.builtin.package:\n    name: example\n')
}

describe('NewRoleModal', () => {
  it('validates and previews every generated file before emitting a publication draft', async () => {
    const wrapper = mountModal()
    await fillRole(wrapper)
    await wrapper.get('form').trigger('submit')
    const previews = wrapper.findAll('[data-testid="role-file-preview"]')
    expect(previews).toHaveLength(4)
    expect(previews[0].text()).toContain('02_ansible_layer/admin/roles/software.install.example/tasks/main.yml')
    expect(previews[0].text()).toContain('ansible.builtin.package')
    expect(wrapper.emitted('prepared')).toBeUndefined()
    await wrapper.get('[data-testid="role-continue"]').trigger('click')
    const draft = wrapper.emitted('prepared')[0][0]
    expect(draft.name).toBe('software.install.example')
    expect(Object.keys(draft.files)).toHaveLength(4)
  })

  it('keeps invalid input and reports the error instead of generating files', async () => {
    const wrapper = mountModal()
    await fillRole(wrapper)
    await wrapper.get('[name="tasks"]').setValue('hosts: all')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toMatch(/task.*list/i)
    expect(wrapper.get('[name="tasks"]').element.value).toBe('hosts: all')
    expect(wrapper.find('[data-testid="role-continue"]').exists()).toBe(false)
  })

  it('requires a fresh preview when fields change so stale files cannot be published', async () => {
    const wrapper = mountModal()
    await fillRole(wrapper)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('[name="target"]').setValue('renamed')
    expect(wrapper.find('[data-testid="role-continue"]').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('[data-testid="role-continue"]').trigger('click')
    expect(wrapper.emitted('prepared')[0][0].name).toBe('software.install.renamed')
  })

  it('reports an existing directory collision without enabling publication', async () => {
    const wrapper = mountModal({ existingPaths: ['02_ansible_layer/admin/roles/software.install.example/files/file.txt'] })
    await fillRole(wrapper)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('already exists')
    expect(wrapper.emitted('prepared')).toBeUndefined()
  })

  it('retains input while hidden for the publication dialog and supports Escape', async () => {
    const wrapper = mountModal()
    await fillRole(wrapper)
    await wrapper.setProps({ open: false })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await wrapper.setProps({ open: true })
    expect(wrapper.get('[name="target"]').element.value).toBe('example')
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
