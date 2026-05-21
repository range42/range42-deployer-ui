import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import NodeAttachmentsSection from '@/components/project/attachments/NodeAttachmentsSection.vue'
import AttachmentEditor from '@/components/project/attachments/AttachmentEditor.vue'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackWarn: false,
    missingWarn: false,
    messages: { en: {} },
  })
}

const NODE_A = { id: 'vm-a', type: 'vm' }

describe('NodeAttachmentsSection', () => {
  // -----------------------------------------------------------------------
  // 1. Empty state shown when no attachments match the node
  // -----------------------------------------------------------------------
  it('shows empty state when attachments array is empty', () => {
    const wrapper = mount(NodeAttachmentsSection, {
      props: {
        node: NODE_A,
        attachments: [],
        nodes: [NODE_A],
      },
      global: { plugins: [makeI18n()] },
    })

    expect(wrapper.find('[data-testid="node-att-empty"]').exists()).toBe(true)
  })

  // -----------------------------------------------------------------------
  // 2. Only attachments targeting the current node are rendered
  // -----------------------------------------------------------------------
  it('renders only attachments for the current node, not unrelated ones', () => {
    const attA = {
      id: 'a1',
      target_node: 'vm-a',
      source: { kind: 'inline_yaml' },
      stage: 'main',
    }
    const attB = {
      id: 'b1',
      target_node: 'vm-b',
      source: { kind: 'inline_yaml' },
      stage: 'main',
    }

    const wrapper = mount(NodeAttachmentsSection, {
      props: {
        node: NODE_A,
        attachments: [attA, attB],
        nodes: [NODE_A],
      },
      global: { plugins: [makeI18n()] },
    })

    expect(wrapper.find('[data-testid="node-att-row-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-att-row-b1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="node-att-empty"]').exists()).toBe(false)
  })

  // -----------------------------------------------------------------------
  // 3. Clicking Add creates a new attachment and emits update:attachments
  // -----------------------------------------------------------------------
  it('adding an inline_yaml attachment emits update:attachments with correct new row', async () => {
    const wrapper = mount(NodeAttachmentsSection, {
      props: {
        node: NODE_A,
        attachments: [],
        nodes: [NODE_A],
      },
      global: { plugins: [makeI18n()] },
    })

    const select = wrapper.find('[data-testid="att-add-kind"]')
    await select.setValue('inline_yaml')

    const addBtn = wrapper.find('[data-testid="att-add-btn"]')
    await addBtn.trigger('click')

    const emitted = wrapper.emitted('update:attachments')
    expect(emitted).toBeTruthy()
    expect(emitted.length).toBe(1)

    const newList = emitted[0][0]
    expect(newList).toHaveLength(1)
    expect(newList[0].target_node).toBe('vm-a')
    expect(newList[0].source.kind).toBe('inline_yaml')
  })

  // -----------------------------------------------------------------------
  // 4. Clicking a row opens AttachmentEditor; editor events propagate correctly
  // -----------------------------------------------------------------------
  it('clicking a row opens AttachmentEditor and propagates update/delete events', async () => {
    const att = {
      id: 'a1',
      target_node: 'vm-a',
      source: { kind: 'inline_yaml' },
      stage: 'main',
    }

    const wrapper = mount(NodeAttachmentsSection, {
      props: {
        node: NODE_A,
        attachments: [att],
        nodes: [NODE_A],
      },
      global: { plugins: [makeI18n()] },
    })

    // Editor should not be visible before clicking the row
    expect(wrapper.findComponent(AttachmentEditor).exists()).toBe(false)

    await wrapper.find('[data-testid="node-att-row-a1"]').trigger('click')

    // Editor should now be visible
    const editor = wrapper.findComponent(AttachmentEditor)
    expect(editor.exists()).toBe(true)

    // update:attachment → emits update:attachments with that row replaced
    const updated = { ...att, title: 'new title' }
    await editor.vm.$emit('update:attachment', updated)
    const updateEmitted = wrapper.emitted('update:attachments')
    expect(updateEmitted).toBeTruthy()
    const updatedList = updateEmitted[updateEmitted.length - 1][0]
    const found = updatedList.find((a) => a.id === 'a1')
    expect(found?.title).toBe('new title')

    // delete → emits update:attachments without that row
    await editor.vm.$emit('delete')
    const deleteEmitted = wrapper.emitted('update:attachments')
    const listAfterDelete = deleteEmitted[deleteEmitted.length - 1][0]
    expect(listAfterDelete.find((a) => a.id === 'a1')).toBeUndefined()
  })
})
