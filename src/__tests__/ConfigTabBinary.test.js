import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, shallowMount } from '@vue/test-utils'
import ConfigTab from '@/components/project/ConfigTab.vue'
import FileTree from '@/components/project/FileTree.vue'
import TwoPaneEditor from '@/components/project/TwoPaneEditor.vue'
import FileAssetField from '@/components/project/FileAssetField.vue'
import { createMemoryFs } from '@/services/projectRepo/memoryFs'
import { assetFromBytes } from '@/services/projectFiles'
enableAutoUnmount(afterEach)

const asset = assetFromBytes(Uint8Array.of(0, 255, 10))
describe('Config tab binary files', () => {
  it('opens binary files in the asset view and saves replacements through the same file system', async () => {
    const overlayFs = createMemoryFs({ files: { 'content/a.bin': asset } })
    const wrapper = shallowMount(ConfigTab, { props: { overlayFs, baseFs: createMemoryFs({ files: {} }) }, global: { stubs: { FileAssetField: false } } })
    wrapper.findComponent(FileTree).vm.$emit('select', { path: 'content/a.bin', fsKind: 'overlay' })
    await flushPromises()
    expect(wrapper.findComponent(TwoPaneEditor).exists()).toBe(false)
    expect(wrapper.get('[data-testid="asset-metadata"]').text()).toContain('3 bytes')
    const replacement = assetFromBytes(Uint8Array.of(128, 0))
    wrapper.findComponent(FileAssetField).vm.$emit('update:modelValue', replacement)
    await flushPromises()
    expect((await overlayFs.getFileContent('content/a.bin')).content).toEqual(replacement)
    expect(wrapper.emitted('save')).toHaveLength(1)
  })
  it('forks binary files without inserting the text tracking header into their bytes', async () => {
    const baseFs = createMemoryFs({ files: { 'content/a.bin': asset } })
    const overlayFs = createMemoryFs({ files: {} })
    const wrapper = shallowMount(FileTree, { props: { baseFs, overlayFs } })
    await flushPromises()
    await wrapper.get('[data-path="content/a.bin"]').trigger('contextmenu')
    await wrapper.get('[role="menuitem"]').trigger('click')
    await flushPromises()
    expect((await overlayFs.getFileContent('content/a.bin')).content).toEqual(asset)
  })
})
