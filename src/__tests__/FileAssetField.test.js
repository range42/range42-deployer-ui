import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import FileAssetField from '@/components/project/FileAssetField.vue'
import { assetFromBytes } from '@/services/projectFiles'
enableAutoUnmount(afterEach)

describe('binary asset field', () => {
  it('shows binary metadata and byte-preserving download without putting base64 in a text editor', () => {
    const asset = assetFromBytes(Uint8Array.of(0, 255, 10), 'application/test')
    const wrapper = mount(FileAssetField, { props: { modelValue: asset, filename: 'fixture.bin' } })
    expect(wrapper.text()).toContain('3 bytes')
    expect(wrapper.text()).not.toContain(asset.content)
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.get('[data-testid="asset-download"]').attributes('download')).toBe('fixture.bin')
    expect(wrapper.get('[data-testid="asset-download"]').attributes('href')).toBe(`data:application/octet-stream;base64,${asset.content}`)
    expect(wrapper.text()).toContain('1 MiB')
  })
  it('rejects oversized uploads before changing the bound file', async () => {
    const wrapper = mount(FileAssetField, { props: { modelValue: '' } })
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(1024 * 1024 + 1)], 'large.bin')] })
    await input.trigger('change')
    expect(wrapper.get('[role=alert]').text()).toContain('1 MiB')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
