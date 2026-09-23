import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import FileUploadForm from '@/components/project/attachments/sources/FileUploadForm.vue'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackWarn: false,
    missingWarn: false,
    messages: { en: {} },
  })
}

function mountForm(source = { kind: 'file_upload' }) {
  return mount(FileUploadForm, {
    props: { source },
    global: { plugins: [makeI18n()] },
    attachTo: document.body,
  })
}

async function selectFile(wrapper, file) {
  const input = wrapper.find('[data-testid="file-input"]').element
  Object.defineProperty(input, 'files', {
    value: [file],
    writable: true,
    configurable: true,
  })
  await wrapper.find('[data-testid="file-input"]').trigger('change')
  // FileReader fires as a macrotask in jsdom; flush microtasks, let the
  // macrotask execute, then flush the resulting resolved Promise.
  await flushPromises()
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
}

describe('FileUploadForm', () => {
  it('emits update:source with base64 content_inline for a valid file', async () => {
    const wrapper = mountForm()
    const file = new File(['hello'], 'cfg.yaml', { type: 'text/yaml' })
    await selectFile(wrapper, file)
    const emitted = wrapper.emitted('update:source')
    expect(emitted).toBeTruthy()
    const payload = emitted[0][0]
    expect(payload.kind).toBe('file_upload')
    expect(typeof payload.content_inline).toBe('string')
    expect(atob(payload.content_inline)).toBe('hello')
  })

  it('shows file meta after selecting a valid file', async () => {
    const wrapper = mountForm()
    const file = new File(['hello'], 'cfg.yaml', { type: 'text/yaml' })
    await selectFile(wrapper, file)
    expect(wrapper.find('[data-testid="file-meta"]').exists()).toBe(true)
  })

  it('does not emit and shows error for files exceeding 256 KB', async () => {
    const wrapper = mountForm()
    const bigFile = new File(['x'.repeat(300000)], 'big.bin')
    await selectFile(wrapper, bigFile)
    expect(wrapper.emitted('update:source')).toBeFalsy()
    expect(wrapper.find('[data-testid="file-error"]').exists()).toBe(true)
  })

  it('clears the error element when a valid file follows an oversized one', async () => {
    const wrapper = mountForm()
    const bigFile = new File(['x'.repeat(300000)], 'big.bin')
    await selectFile(wrapper, bigFile)
    expect(wrapper.find('[data-testid="file-error"]').exists()).toBe(true)

    const validFile = new File(['ok'], 'ok.yaml', { type: 'text/yaml' })
    await selectFile(wrapper, validFile)
    expect(wrapper.find('[data-testid="file-error"]').exists()).toBe(false)
  })
})
