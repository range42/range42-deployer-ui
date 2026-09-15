import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, shallowMount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import project from '@/locales/en/project.json'
import ConfigTab from '@/components/project/ConfigTab.vue'
import FileTree from '@/components/project/FileTree.vue'
import TwoPaneEditor from '@/components/project/TwoPaneEditor.vue'
import { createMemoryFs } from '@/services/projectRepo/memoryFs'

enableAutoUnmount(afterEach)
const baseFs = () => createMemoryFs({ files: {} })
function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function mountFiles(files, props = {}) {
  return shallowMount(ConfigTab, { props: { baseFs: baseFs(), overlayFs: createMemoryFs({ files }), ...props }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { project } } })] } })
}
async function select(wrapper, path) {
  wrapper.findComponent(FileTree).vm.$emit('select', { path, fsKind: 'overlay' })
  await flushPromises()
}

describe('Config tab selected file continuity', () => {
  it('prefills an existing saved file on initial Config tab entry', async () => {
    const wrapper = mountFiles({ 'first.yml': 'saved: content\n' })
    await flushPromises()
    expect(wrapper.findComponent(TwoPaneEditor).props()).toMatchObject({ path: 'first.yml', overlayContent: 'saved: content\n', overlayExists: true })
  })

  it('opens a requested file path and reacts to browser history selecting another path', async () => {
    const wrapper = mountFiles({ 'first.yml': 'first', 'second.yml': 'second' }, { path: 'second.yml' })
    await flushPromises()
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('second')
    await wrapper.setProps({ path: 'first.yml' })
    await flushPromises()
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('first')
  })

  it('does not expose or save the previous file bytes under a newly loading path', async () => {
    const pending = deferred(), fs = createMemoryFs({ files: { 'a.yml': 'first', 'b.yml': 'second' } })
    const originalRead = fs.getFileContent.bind(fs)
    fs.getFileContent = path => path === 'b.yml' ? pending.promise : originalRead(path)
    fs.putFile = vi.fn(fs.putFile.bind(fs))
    const wrapper = mountFiles({}, { overlayFs: fs })
    await select(wrapper, 'a.yml')
    const oldEditor = wrapper.findComponent(TwoPaneEditor)
    await select(wrapper, 'b.yml')
    expect(wrapper.find('[data-testid="config-file-loading"]').exists()).toBe(true)
    expect(wrapper.findComponent(TwoPaneEditor).exists()).toBe(false)
    oldEditor.vm.$emit('save', { path: 'b.yml', content: 'first' })
    expect(fs.putFile).not.toHaveBeenCalled()
    pending.resolve({ content: 'second', sha: 'second' })
    await flushPromises()
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('second')
  })

  it('ignores an older failed read after a newer file is already selected', async () => {
    const pending = deferred(), fs = createMemoryFs({ files: { 'a.yml': 'first', 'b.yml': 'second' } })
    const originalRead = fs.getFileContent.bind(fs)
    fs.getFileContent = path => path === 'a.yml' ? pending.promise : originalRead(path)
    const wrapper = mountFiles({}, { overlayFs: fs })
    await select(wrapper, 'a.yml')
    await select(wrapper, 'b.yml')
    pending.reject(new Error('Old request refused'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Old request refused')
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('second')
  })

  it('refreshes clean selected content when scenario generation replaces project files', async () => {
    const wrapper = mountFiles({ 'main.yml': 'old generated tasks' })
    await select(wrapper, 'main.yml')
    await wrapper.setProps({ overlayFs: createMemoryFs({ files: { 'main.yml': 'new generated tasks' } }) })
    await flushPromises()
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('new generated tasks')
  })

  it('retains a draft and blocks stale overwrite until an external file change is reviewed', async () => {
    const wrapper = mountFiles({ 'main.yml': 'saved before' })
    await select(wrapper, 'main.yml')
    wrapper.findComponent(TwoPaneEditor).vm.$emit('update:overlay-content', 'unsaved draft')
    await flushPromises()
    const replacement = createMemoryFs({ files: { 'main.yml': 'generated meanwhile' } })
    replacement.putFile = vi.fn(replacement.putFile.bind(replacement))
    await wrapper.setProps({ overlayFs: replacement })
    await flushPromises()
    expect(wrapper.findComponent(TwoPaneEditor).props('overlayContent')).toBe('unsaved draft')
    expect(wrapper.find('[data-testid="config-file-conflict"]').exists()).toBe(true)
    wrapper.findComponent(TwoPaneEditor).vm.$emit('save', { path: 'main.yml', content: 'unsaved draft' })
    await flushPromises()
    expect(replacement.putFile).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="config-keep-draft"]').trigger('click')
    wrapper.findComponent(TwoPaneEditor).vm.$emit('save', { path: 'main.yml', content: 'unsaved draft' })
    await flushPromises()
    expect((await replacement.getFileContent('main.yml')).content).toBe('unsaved draft')
  })

  it.each(['selection', 'unmount'])('does not emit a completed old file save after %s changes context', async change => {
    const saved = deferred(), fs = createMemoryFs({ files: { 'first.yml': 'first', 'second.yml': 'second' } })
    fs.putFile = () => saved.promise
    const wrapper = mountFiles({}, { overlayFs: fs })
    await select(wrapper, 'first.yml')
    wrapper.findComponent(TwoPaneEditor).vm.$emit('save', { path: 'first.yml', content: 'edited first' })
    if (change === 'selection') await select(wrapper, 'second.yml')
    else wrapper.unmount()
    saved.resolve({ sha: 'saved-first' })
    await flushPromises()
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('does not silently create a missing URL-selected file', async () => {
    const wrapper = mountFiles({ 'first.yml': 'saved' }, { path: 'missing.yml' })
    await flushPromises()
    expect(wrapper.findComponent(TwoPaneEditor).exists()).toBe(false)
    expect(wrapper.find('[data-testid="config-file-error"]').exists()).toBe(true)
  })
})
