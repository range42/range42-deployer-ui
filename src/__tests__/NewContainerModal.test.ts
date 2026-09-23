import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import NewContainerModal from '@/components/catalog/NewContainerModal.vue'

vi.mock('focus-trap-vue', () => ({ FocusTrap: { template: '<div><slot /></div>' } }))
enableAutoUnmount(afterEach)

async function modal() {
  const wrapper = mount(NewContainerModal, { props: { open: true }, global: { plugins: [createI18n({ legacy: false, locale: 'en' })] } })
  await wrapper.get('[name="target"]').setValue('training_web')
  await wrapper.get('[name="description"]').setValue('Training web server')
  return wrapper
}

describe('Compose text-file authoring', () => {
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
