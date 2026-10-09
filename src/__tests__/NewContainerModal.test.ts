import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import NewContainerModal from '@/components/catalog/NewContainerModal.vue'
import FileAssetField from '@/components/project/FileAssetField.vue'
import { assetFromBytes } from '@/services/projectFiles'

vi.mock('focus-trap-vue', () => ({ FocusTrap: { template: '<div><slot /></div>' } }))
enableAutoUnmount(afterEach)

async function modal() {
  const wrapper = mount(NewContainerModal, { props: { open: true }, global: { plugins: [createI18n({ legacy: false, locale: 'en' })] } })
  await wrapper.get('[name="target"]').setValue('training_web')
  await wrapper.get('[name="description"]').setValue('Training web server')
  return wrapper
}

describe('Compose text-file authoring', () => {
  it('accepts an uploaded UTF-8 Dockerfile as executable build text without changing its bytes', async () => {
    const wrapper = await modal()
    await wrapper.get('[name="compose"]').setValue('services:\n  web:\n    build: .\n')
    await wrapper.get('[data-testid="container-add-file"]').trigger('click')
    await wrapper.get('[name="file-path-0"]').setValue('Dockerfile')
    const dockerfile = 'FROM nginx:stable-alpine\r\n'
    wrapper.getComponent(FileAssetField).vm.$emit('update:modelValue', assetFromBytes(new TextEncoder().encode(dockerfile), 'text/plain'))
    await wrapper.vm.$nextTick()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.find('[data-testid="container-continue"]').exists()).toBe(true)
    await wrapper.get('[data-testid="container-continue"]').trigger('click')
    expect(wrapper.emitted('prepared')?.[0]?.[0]).toMatchObject({ files: { '03_container_layer/docker/admin/training_web/Dockerfile': dockerfile } })
  })

  it('reviews an uploaded picture as a binary asset and preserves it in the publication draft', async () => {
    const wrapper = await modal()
    await wrapper.get('[name="compose"]').setValue('services:\n  web:\n    image: nginx:alpine\n    volumes: ["./site:/usr/share/nginx/html:ro"]\n')
    await wrapper.get('[data-testid="container-add-file"]').trigger('click')
    await wrapper.get('[name="file-path-0"]').setValue('site/logo.png')
    const picture = assetFromBytes(new Uint8Array([137, 80, 78, 71, 0, 255]), 'image/png')
    const upload = wrapper.getComponent(FileAssetField)
    upload.vm.$emit('update:modelValue', picture)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[name="file-content-0"]').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    const preview = wrapper.findAll('[data-testid="container-file-preview"]').find(row => row.text().includes('/site/logo.png'))!
    expect(preview.text()).toContain('6 bytes')
    expect(preview.text()).not.toContain(picture.content)
    await wrapper.get('[data-testid="container-continue"]').trigger('click')
    expect(wrapper.emitted('prepared')?.[0]?.[0]).toMatchObject({ files: { '03_container_layer/docker/admin/training_web/site/logo.png': picture } })
    upload.vm.$emit('update:modelValue', assetFromBytes(new Uint8Array([1, 2, 3]), 'image/png'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="container-continue"]').exists()).toBe(false)
  })

  it('reviews explicit path/content rows, preserves bytes and invalidates review after an edit', async () => {
    const wrapper = await modal()
    await wrapper.get('[name="compose"]').setValue('services:\n  web:\n    image: nginx:alpine\n    volumes: ["./site:/usr/share/nginx/html:ro"]\n')
    await wrapper.get('[data-testid="container-add-file"]').trigger('click')
    await wrapper.get('[name="file-path-0"]').setValue('site/index.html')
    await wrapper.get('[name="file-content-0"]').setValue('<h1>Training</h1>\n')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.findAll('[data-testid="container-file-preview"]')).toHaveLength(4)
    await wrapper.get('[data-testid="container-continue"]').trigger('click')
    expect(wrapper.emitted('prepared')?.[0]?.[0]).toMatchObject({ files: { '03_container_layer/docker/admin/training_web/site/index.html': '<h1>Training</h1>\n' } })
    await wrapper.get('[name="file-content-0"]').setValue('Changed content')
    expect(wrapper.find('[data-testid="container-continue"]').exists()).toBe(false)
  })

  it('refuses duplicate paths instead of silently overwriting the first file', async () => {
    const wrapper = await modal()
    for (const index of [0, 1]) {
      await wrapper.get('[data-testid="container-add-file"]').trigger('click')
      await wrapper.get(`[name="file-path-${index}"]`).setValue('site/index.html')
      await wrapper.get(`[name="file-content-${index}"]`).setValue(`Content ${index}`)
    }
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toMatch(/duplicate|already/i)
    expect(wrapper.find('[data-testid="container-continue"]').exists()).toBe(false)
    await wrapper.get('[data-testid="container-remove-file-1"]').trigger('click')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('[data-testid="container-continue"]').trigger('click')
    expect(wrapper.emitted('prepared')?.[0]?.[0]).toMatchObject({ files: { '03_container_layer/docker/admin/training_web/site/index.html': 'Content 0' } })
  })

  it.each(['../escape', '/tmp/escape', '.git/config', 'compose.yml'])('reports invalid or reserved path %s before publication', async path => {
    const wrapper = await modal()
    await wrapper.get('[data-testid="container-add-file"]').trigger('click')
    await wrapper.get('[name="file-path-0"]').setValue(path)
    await wrapper.get('[name="file-content-0"]').setValue('Example')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toMatch(/path|replace|reserved/i)
    expect(wrapper.find('[data-testid="container-continue"]').exists()).toBe(false)
    expect(wrapper.emitted('prepared')).toBeUndefined()
  })
})
