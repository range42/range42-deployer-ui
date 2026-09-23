/**
 * TemplateBrowser must mount without throwing (range42-deployer-ui#92).
 *
 * onMounted calls setConfig(props.apiUrl, props.proxmoxNode); when the
 * composable did not export it, rendering the component with an apiUrl threw
 * "setConfig is not a function" — a hard runtime error, not a degraded view.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

import TemplateBrowser from '@/components/TemplateBrowser.vue'

vi.mock('@/services/proxmox/api', () => ({
  setBaseUrl: vi.fn(),
  storage: {
    listStoragePools: vi.fn().mockResolvedValue([]),
    listTemplates: vi.fn().mockResolvedValue([]),
    listIsos: vi.fn().mockResolvedValue([]),
    downloadIso: vi.fn().mockResolvedValue({}),
  },
}))

const stubs = { AppIcon: true }

describe('TemplateBrowser mount', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('mounts with an apiUrl and node without throwing', () => {
    const wrapper = mount(TemplateBrowser, {
      props: { apiUrl: 'http://10.0.0.5:8000', proxmoxNode: 'pve01' },
      global: { stubs },
    })
    expect(wrapper.exists()).toBe(true)
  })

  it('mounts with no host props at all', () => {
    const wrapper = mount(TemplateBrowser, { global: { stubs } })
    expect(wrapper.exists()).toBe(true)
  })
})
