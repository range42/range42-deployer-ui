import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AttachmentManager from '@/components/project/AttachmentManager.vue'
import AttachmentEditor from '@/components/project/attachments/AttachmentEditor.vue'

// AttachmentEditor uses useI18n — we need a plugin for it to mount correctly.
// AttachmentManager itself does NOT use i18n (plain text), so we only need
// the plugin for the child component when it is mounted.
function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackWarn: false,
    missingWarn: false,
    messages: { en: {} },
  })
}

// Stub sub-forms inside AttachmentEditor so no fetch / catalog calls fire.
vi.mock('@/components/project/attachments/sources/CatalogPickerForm.vue', () => ({
  default: { name: 'CatalogPickerForm', template: '<div />' },
}))
vi.mock('@/components/project/attachments/sources/InlineYamlForm.vue', () => ({
  default: { name: 'InlineYamlForm', template: '<div data-testid="inline-yaml" />' },
}))
vi.mock('@/components/project/attachments/sources/FileUploadForm.vue', () => ({
  default: { name: 'FileUploadForm', template: '<div />' },
}))
vi.mock('@/components/project/attachments/sources/ExternalGitForm.vue', () => ({
  default: { name: 'ExternalGitForm', template: '<div />' },
}))

const NODES = [{ id: 'vm-a', type: 'vm' }]

const BASE_ATTACHMENT = {
  id: 'a1',
  target_node: 'vm-a',
  source: { kind: 'catalog_role', ref: 'src:roles/x' },
  stage: 'main',
}

function mountManager(attachments = [BASE_ATTACHMENT], nodes = NODES) {
  return mount(AttachmentManager, {
    props: { attachments, nodes },
    global: { plugins: [makeI18n()] },
  })
}

// ---------------------------------------------------------------------------
// 1. Kind and Source columns rendered for catalog_role
// ---------------------------------------------------------------------------
describe('Kind + Source columns', () => {
  it('shows kind and source for catalog_role with ref', () => {
    const wrapper = mountManager()
    expect(wrapper.find('[data-testid="att-kind-a1"]').text()).toBe('catalog_role')
    expect(wrapper.find('[data-testid="att-src-a1"]').text()).toBe('src:roles/x')
  })

  it('shows "inline" for inline_yaml source', () => {
    const att = { id: 'a2', target_node: 'vm-a', source: { kind: 'inline_yaml' }, stage: 'main' }
    const wrapper = mountManager([att])
    expect(wrapper.find('[data-testid="att-src-a2"]').text()).toBe('inline')
  })

  it('shows url for external_git source', () => {
    const att = {
      id: 'a3',
      target_node: 'vm-a',
      source: { kind: 'external_git', url: 'https://github.com/org/repo' },
      stage: 'main',
    }
    const wrapper = mountManager([att])
    expect(wrapper.find('[data-testid="att-src-a3"]').text()).toBe('https://github.com/org/repo')
  })

  it('shows "file" for file_upload source', () => {
    const att = { id: 'a4', target_node: 'vm-a', source: { kind: 'file_upload' }, stage: 'main' }
    const wrapper = mountManager([att])
    expect(wrapper.find('[data-testid="att-src-a4"]').text()).toBe('file')
  })

  it('shows "—" for catalog_role with no ref', () => {
    const att = {
      id: 'a5',
      target_node: 'vm-a',
      source: { kind: 'catalog_container' },
      stage: 'main',
    }
    const wrapper = mountManager([att])
    expect(wrapper.find('[data-testid="att-src-a5"]').text()).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// 2. Row Edit button → opens AttachmentEditor
// ---------------------------------------------------------------------------
describe('Row Edit button', () => {
  it('AttachmentEditor is absent before clicking edit', () => {
    const wrapper = mountManager()
    expect(wrapper.findComponent(AttachmentEditor).exists()).toBe(false)
  })

  it('clicking att-edit-<id> shows AttachmentEditor for that attachment', async () => {
    const wrapper = mountManager()
    await wrapper.find('[data-testid="att-edit-a1"]').trigger('click')
    const editor = wrapper.findComponent(AttachmentEditor)
    expect(editor.exists()).toBe(true)
    expect(editor.props('attachment').id).toBe('a1')
  })

  it('AttachmentEditor @update:attachment emits update:attachments with the attachment replaced', async () => {
    const wrapper = mountManager()
    await wrapper.find('[data-testid="att-edit-a1"]').trigger('click')
    const editor = wrapper.findComponent(AttachmentEditor)
    const updated = { ...BASE_ATTACHMENT, title: 'new title' }
    await editor.vm.$emit('update:attachment', updated)
    const emitted = wrapper.emitted('update:attachments')
    expect(emitted).toBeTruthy()
    const last = emitted[emitted.length - 1][0]
    const found = last.find((a) => a.id === 'a1')
    expect(found.title).toBe('new title')
  })

  it('AttachmentEditor @delete emits update:attachments without the attachment and closes editor', async () => {
    const wrapper = mountManager()
    await wrapper.find('[data-testid="att-edit-a1"]').trigger('click')
    const editor = wrapper.findComponent(AttachmentEditor)
    await editor.vm.$emit('delete')
    const emitted = wrapper.emitted('update:attachments')
    expect(emitted).toBeTruthy()
    const last = emitted[emitted.length - 1][0]
    expect(last.find((a) => a.id === 'a1')).toBeUndefined()
    // editor should be gone
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(AttachmentEditor).exists()).toBe(false)
  })

  it('AttachmentEditor @close hides the editor', async () => {
    const wrapper = mountManager()
    await wrapper.find('[data-testid="att-edit-a1"]').trigger('click')
    expect(wrapper.findComponent(AttachmentEditor).exists()).toBe(true)
    await wrapper.findComponent(AttachmentEditor).vm.$emit('close')
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(AttachmentEditor).exists()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Global add control
// ---------------------------------------------------------------------------
describe('Global add control', () => {
  it('add-node select has an option for each node', () => {
    const wrapper = mountManager()
    const opts = wrapper.find('[data-testid="add-node"]').findAll('option')
    // There may be a blank placeholder — at minimum vm-a is present
    const values = opts.map((o) => o.element.value)
    expect(values).toContain('vm-a')
  })

  it('add-kind select has the 5 kinds', () => {
    const wrapper = mountManager()
    const opts = wrapper.find('[data-testid="add-kind"]').findAll('option')
    const values = opts.map((o) => o.element.value)
    expect(values).toContain('catalog_role')
    expect(values).toContain('catalog_container')
    expect(values).toContain('inline_yaml')
    expect(values).toContain('file_upload')
    expect(values).toContain('external_git')
  })

  it('clicking Add emits update:attachments with a new inline_yaml attachment targeting vm-a', async () => {
    const wrapper = mountManager()

    await wrapper.find('[data-testid="add-node"]').setValue('vm-a')
    await wrapper.find('[data-testid="add-kind"]').setValue('inline_yaml')
    await wrapper.find('[data-testid="add-btn"]').trigger('click')

    const emitted = wrapper.emitted('update:attachments')
    expect(emitted).toBeTruthy()
    const payload = emitted[emitted.length - 1][0]
    expect(payload.length).toBe(2) // original + new
    const newAtt = payload.find((a) => a.id !== 'a1')
    expect(newAtt.target_node).toBe('vm-a')
    expect(newAtt.source.kind).toBe('inline_yaml')
  })

  it('after Add the AttachmentEditor is shown for the new attachment', async () => {
    const wrapper = mountManager()

    await wrapper.find('[data-testid="add-node"]').setValue('vm-a')
    await wrapper.find('[data-testid="add-kind"]').setValue('inline_yaml')
    await wrapper.find('[data-testid="add-btn"]').trigger('click')

    // The manager emitted but it manages its own editingId internally.
    // The new attachment must now be passed back via props update to show editor.
    // Simulate the parent update by setting new props.
    const emitted = wrapper.emitted('update:attachments')
    const newList = emitted[emitted.length - 1][0]
    await wrapper.setProps({ attachments: newList })

    expect(wrapper.findComponent(AttachmentEditor).exists()).toBe(true)
  })

  it('clicking Add without a chosen node does NOT emit', async () => {
    const wrapper = mountManager()
    // Don't set add-node; default select value is empty placeholder
    await wrapper.find('[data-testid="add-kind"]').setValue('inline_yaml')
    await wrapper.find('[data-testid="add-btn"]').trigger('click')
    expect(wrapper.emitted('update:attachments')).toBeFalsy()
  })
})
