import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import WorkloadReviewPanel from '@/components/project/WorkloadReviewPanel.vue'
import { validateCatalogWorkloadReview } from '@/services/catalogWorkload'
import { customSimulation } from './fixtures/customSimulation'

enableAutoUnmount(afterEach)
const prefix = 'scenarios/saved/content/workloads/web'
async function panel() {
  const { project } = await customSimulation()
  project.files[`${prefix}/payload/site/index.html`] = '<h1>Updated website</h1>'
  const wrapper = mount(WorkloadReviewPanel, { props: { project, path: `${prefix}/payload/site/index.html` },
    global: { plugins: [createI18n({ legacy: false, locale: 'en' })] } })
  return { project, wrapper }
}

describe('application update review', () => {
  it('reviews the actual edited payload and emits compiler-ready files only after applying', async () => {
    const { project, wrapper } = await panel()
    const before = structuredClone(project)
    await wrapper.get('[data-testid="workload-review"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="workload-review-summary"]').text()).toContain('site/logo.png')
    expect(wrapper.emitted('apply')).toBeUndefined()
    expect(project).toEqual(before)
    await wrapper.get('[data-testid="workload-review-apply"]').trigger('click')
    const result = wrapper.emitted('apply')![0][0] as { projectId: string; files: typeof project.files }
    expect(result.projectId).toBe(project.id)
    expect(result.files[`${prefix}/payload/site/index.html`]).toBe('<h1>Updated website</h1>')
    expect(() => validateCatalogWorkloadReview({ files: result.files, scenarioLabel: 'saved', attachmentId: 'web', projectId: project.id })).not.toThrow()
  })

  it('invalidates a completed review when project content changes', async () => {
    const { project, wrapper } = await panel()
    await wrapper.get('[data-testid="workload-review"]').trigger('click'); await flushPromises()
    await wrapper.setProps({ project: { ...project, files: { ...project.files, 'notes.txt': 'another tab edited these notes' } } })
    expect(wrapper.find('[data-testid="workload-review-apply"]').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('changed')
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('keeps a completed review while an unchanged project is checkpointed', async () => {
    const { project, wrapper } = await panel()
    await wrapper.get('[data-testid="workload-review"]').trigger('click'); await flushPromises()
    await wrapper.setProps({ project: { ...project, modified: '2026-09-24T12:00:00Z', head_sha: 'c'.repeat(40),
      git: { ...project.git, working_branch: 'range42-ui/checkpoint' } } })
    expect(wrapper.find('[data-testid="workload-review-apply"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('retains invalid application edits and explains why they cannot be applied', async () => {
    const { project, wrapper } = await panel()
    await wrapper.setProps({ project: { ...project, files: { ...project.files, [`${prefix}/payload/compose.yml`]: 'services: {}\n' } } })
    await wrapper.get('[data-testid="workload-review"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/services|service/)
    expect(wrapper.find('[data-testid="workload-review-apply"]').exists()).toBe(false)
    expect(wrapper.emitted('apply')).toBeUndefined()
  })
})
