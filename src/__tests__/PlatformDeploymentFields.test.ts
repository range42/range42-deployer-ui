import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import NativeDeploymentFields from '@/components/project/NativeDeploymentFields.vue'
import deployment from '@/locales/en/deployment.json'

enableAutoUnmount(afterEach)
vi.mock('@/services/backendApi', () => ({ getBackendScope: () => 'fixture', backendRequest: async (url: string) =>
  url === '/v1/contexts' ? { items: [{ id: 'pve', target_host_id: 'host', ready: true, issues: [] }] } : {
    features: [{ id: 'UI', default: true }, { id: 'WAZUH', default: true }],
    platform: { version: 1, id: 'alpha', domain: 'alpha.example.test', profile: 'full',
      unavailable: { misp: 'unavailable', emp: 'preview' },
      presets: [{ id: 'core', features: { UI: true, WAZUH: false } },
        { id: 'full', features: { UI: true, WAZUH: true } }],
      parameters: [{ name: 'stack_source_dir', label: 'Application release', type: 'path', required: true }] },
  } }))

it('uses declared presets and prevents deployment until required setup is provided', async () => {
  const wrapper = mount(NativeDeploymentFields, { props: { projectId: 'project', revision: 'a'.repeat(40), path: 'scenarios/alpha' },
    global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en: { deployment } } })] } })
  await flushPromises()
  expect(wrapper.emitted('select')?.at(-1)).toEqual([null])
  expect(wrapper.text()).toContain('misp')
  expect(wrapper.text()).toContain('emp')
  await wrapper.get('[data-testid="platform-preset-core"]').trigger('click')
  await wrapper.get('[data-testid="platform-input-stack_source_dir"]').setValue('/srv/release/sources')
  await flushPromises()
  expect(wrapper.emitted('select')?.at(-1)?.[0]).toMatchObject({
    features: { UI: true, WAZUH: false }, parameters: { stack_source_dir: '/srv/release/sources' },
  })
  await wrapper.get('[data-testid="platform-input-stack_source_dir"]').setValue('relative')
  expect(wrapper.emitted('select')?.at(-1)).toEqual([null])
})
