import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import 'fake-indexeddb/auto'
import AttachmentEditor from '@/components/project/attachments/AttachmentEditor.vue'
import InlineYamlForm from '@/components/project/attachments/sources/InlineYamlForm.vue'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackWarn: false,
    missingWarn: false,
    messages: { en: {} },
  })
}

const EMPTY_CATALOG_RESPONSE = {
  ok: true,
  json: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
}

describe('AttachmentEditor', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = () => Promise.resolve(EMPTY_CATALOG_RESPONSE)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // -------------------------------------------------------------------------
  // 1. Renders the correct sub-form; scope absent when target is not a group
  // -------------------------------------------------------------------------
  it('renders InlineYamlForm for inline_yaml kind and hides scope when not a group', () => {
    const wrapper = mount(AttachmentEditor, {
      props: {
        attachment: {
          id: 'a',
          target_node: 'vm-a',
          source: { kind: 'inline_yaml', content_inline: 'x: 1\n' },
          stage: 'main',
        },
        nodes: [{ id: 'vm-a', type: 'vm' }],
      },
      global: { plugins: [makeI18n()] },
    })

    expect(wrapper.find('[data-testid="inline-yaml"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="att-scope"]').exists()).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 2. Editing att-title emits update:attachment preserving other fields
  // -------------------------------------------------------------------------
  it('editing att-title emits update:attachment with title patch preserving other fields', async () => {
    const attachment = {
      id: 'a',
      target_node: 'vm-a',
      source: { kind: 'inline_yaml', content_inline: 'x: 1\n' },
      stage: 'main',
    }
    const wrapper = mount(AttachmentEditor, {
      props: {
        attachment,
        nodes: [{ id: 'vm-a', type: 'vm' }],
      },
      global: { plugins: [makeI18n()] },
    })

    const input = wrapper.find('[data-testid="att-title"]')
    await input.setValue('My title')

    const emitted = wrapper.emitted('update:attachment')
    expect(emitted).toBeTruthy()
    const payload = emitted[emitted.length - 1][0]
    expect(payload.title).toBe('My title')
    expect(payload.source).toEqual(attachment.source)
    expect(payload.stage).toBe('main')
    expect(payload.target_node).toBe('vm-a')
  })

  // -------------------------------------------------------------------------
  // 3. Editing att-order emits order_in_stage as a Number
  // -------------------------------------------------------------------------
  it('editing att-order emits order_in_stage as Number', async () => {
    const wrapper = mount(AttachmentEditor, {
      props: {
        attachment: {
          id: 'a',
          target_node: 'vm-a',
          source: { kind: 'inline_yaml', content_inline: '' },
          stage: 'main',
        },
        nodes: [{ id: 'vm-a', type: 'vm' }],
      },
      global: { plugins: [makeI18n()] },
    })

    const input = wrapper.find('[data-testid="att-order"]')
    await input.setValue('2')

    const emitted = wrapper.emitted('update:attachment')
    expect(emitted).toBeTruthy()
    const payload = emitted[emitted.length - 1][0]
    expect(payload.order_in_stage).toBe(2)
    expect(typeof payload.order_in_stage).toBe('number')
  })

  // -------------------------------------------------------------------------
  // 4. Inner form update:source propagates as update:attachment with new source
  // -------------------------------------------------------------------------
  it('propagates update:source from inner form as update:attachment with new source', async () => {
    const attachment = {
      id: 'a',
      target_node: 'vm-a',
      source: { kind: 'inline_yaml', content_inline: 'x: 1\n' },
      stage: 'main',
    }
    const wrapper = mount(AttachmentEditor, {
      props: {
        attachment,
        nodes: [{ id: 'vm-a', type: 'vm' }],
      },
      global: { plugins: [makeI18n()] },
    })

    const newSource = { kind: 'inline_yaml', content_inline: 'y: 2\n' }
    wrapper.findComponent(InlineYamlForm).vm.$emit('update:source', newSource)
    await wrapper.vm.$nextTick()

    const emitted = wrapper.emitted('update:attachment')
    expect(emitted).toBeTruthy()
    const payload = emitted[emitted.length - 1][0]
    expect(payload.source).toEqual(newSource)
    expect(payload.id).toBe('a')
    expect(payload.stage).toBe('main')
  })

  // -------------------------------------------------------------------------
  // 5. Scope control visible and functional when target node is a group
  // -------------------------------------------------------------------------
  it('shows att-scope for group target and emits scope on change', async () => {
    const wrapper = mount(AttachmentEditor, {
      props: {
        attachment: {
          id: 'b',
          target_node: 'g1',
          source: { kind: 'inline_yaml', content_inline: '' },
          stage: 'pre',
        },
        nodes: [{ id: 'g1', type: 'group' }],
      },
      global: { plugins: [makeI18n()] },
    })

    const scopeSelect = wrapper.find('[data-testid="att-scope"]')
    expect(scopeSelect.exists()).toBe(true)

    await scopeSelect.setValue('group_inherited')

    const emitted = wrapper.emitted('update:attachment')
    expect(emitted).toBeTruthy()
    const payload = emitted[emitted.length - 1][0]
    expect(payload.scope).toBe('group_inherited')
  })

  // -------------------------------------------------------------------------
  // 6. Delete and close buttons emit the correct events
  // -------------------------------------------------------------------------
  it('delete button emits delete and close button emits close', async () => {
    const wrapper = mount(AttachmentEditor, {
      props: {
        attachment: {
          id: 'a',
          target_node: 'vm-a',
          source: { kind: 'inline_yaml', content_inline: '' },
          stage: 'main',
        },
        nodes: [{ id: 'vm-a', type: 'vm' }],
      },
      global: { plugins: [makeI18n()] },
    })

    await wrapper.find('[data-testid="att-delete"]').trigger('click')
    expect(wrapper.emitted('delete')).toBeTruthy()

    await wrapper.find('[data-testid="att-close"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
