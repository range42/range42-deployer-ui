import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import EditorPreferencesPanel from '@/components/settings/EditorPreferencesPanel.vue'
import { useEditorPreferencesStore } from '@/stores/editorPreferencesStore'

beforeEach(() => localStorage.clear())
describe('EditorPreferencesPanel', () => {
  it('exposes labelled functional controls and explains local drafts and working-branch scope', async () => {
    const pinia = createPinia()
    const wrapper = mount(EditorPreferencesPanel, { global: { plugins: [pinia] } })
    const preferences = useEditorPreferencesStore(pinia)
    expect(wrapper.text()).toContain('Git working branch')
    expect(wrapper.text()).toContain('Local drafts are always kept')
    expect(wrapper.text()).toContain('Explicit Save')
    await wrapper.get('#editor-auto-save-git').setValue(false)
    await wrapper.get('#editor-snap-to-grid').setValue(false)
    await wrapper.get('#editor-grid-size').setValue('35')
    expect(preferences.autoSaveToGit).toBe(false)
    expect(preferences.snapToGrid).toBe(false)
    expect(preferences.gridSize).toBe(35)
    for (const id of ['editor-auto-save-git', 'editor-snap-to-grid', 'editor-grid-size']) {
      expect(wrapper.get(`label[for="${id}"]`).text().length).toBeGreaterThan(0)
    }
    expect(wrapper.get('#editor-grid-size').attributes()).toMatchObject({ min: '10', max: '50', step: '1' })
    wrapper.unmount()
  })
})
