import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import RuntimeGitRecords from '@/components/deployment/RuntimeGitRecords.vue'
import runtime from '@/locales/en/runtime.json'
import { useProjectStore } from '@/stores/projectStore'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { buildRuntimeRecord } from '@/services/runtimeGitRecords'

const { save } = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/services/runtimeGitRecords', async importOriginal => ({ ...await importOriginal(), saveRuntimeRecord: save }))
vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))
enableAutoUnmount(afterEach)
const scope = 'https://backend.test'
const deployment = { id: 'dep-1', project_id: 'project-1', scenario_label: 'demo', target_host_id: 'host-1' }
const operation = { request: { kind: 'vm_firewall', vm_id: 3191, enabled: true }, target_host_id: 'host-1', project_sha: 'a'.repeat(40) }
const attempt = { id: 'attempt-1', deployment_id: 'dep-1', operation, project_sha: 'a'.repeat(40), state: 'deploying' }
let project
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useBackendApiStore().addHost({ url: scope })
  project = { id: 'project-1', name: 'Demo', scenario: { label: 'demo' }, files: { 'content/existing': 'keep' }, nodes: [], edges: [], head_sha: 'a'.repeat(40),
    git: { source_id: 'src', provider: 'github', base_url: 'https://github.com', repo_owner: 'team', repo_name: 'lab', branch: 'main', branch_strategy: 'dedicated_repo' } }
  localStorage.setItem('range42_projects', JSON.stringify([project]))
  localStorage.setItem('range42_project_registrations', JSON.stringify({ [JSON.stringify([scope, project.id, 'src', 'dedicated_repo', 'team', 'lab', ''])]: { id: project.id } }))
  useProjectStore().loadProjects()
  save.mockReset().mockImplementation(async (_project, dep, att, backend) => ({ ...buildRuntimeRecord(dep, att, backend),
    commit_sha: 'b'.repeat(40), expected_head: 'a'.repeat(40), branch: 'range42-ui/project-1' }))
})
async function show(props = {}) {
  const wrapper = mount(RuntimeGitRecords, { props: { deployment, attempts: [attempt], ...props }, global: {
    plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { runtime } } })],
    stubs: { RouterLink: { template: '<a><slot /></a>' } },
  } })
  await flushPromises()
  return wrapper
}

describe('runtime Git save status', () => {
  const snapshotAttempt = { id: 'snapshot-attempt', deployment_id: deployment.id, scope: 'snapshot_set', state: 'succeeded',
    operation: { kind: 'snapshot_set', operation_id: 'snapshot-operation' } }

  it('does not render Git records for snapshot-set attempts, including a newly received attempt', async () => {
    const wrapper = await show({ attempts: [snapshotAttempt], newAttempt: snapshotAttempt })
    expect(wrapper.find('[data-testid="runtime-git-records"]').exists()).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(useProjectStore().getProject(project.id).files).toEqual(project.files)
  })

  it('keeps network runtime records saveable alongside snapshot-set history', async () => {
    const networkAttempt = { ...attempt, scope: 'runtime', operation: { ...operation,
      request: { kind: 'sdn_network', action: 'create', vnet: 'r42blue', acknowledge_shared_scope: true, review_fingerprint: 'a'.repeat(64) } } }
    const wrapper = await show({ attempts: [snapshotAttempt, networkAttempt] })
    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.text()).toContain('Network lifecycle')
    expect(wrapper.text()).not.toContain(snapshotAttempt.id)
    expect(wrapper.text()).not.toContain('runtime.operations.undefined')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.get('[data-testid="runtime-git-save-attempt-1"]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][2]).toEqual(networkAttempt)
    expect(wrapper.text()).toContain('Saved request')
  })

  it('offers historical changes for explicit save without writing merely on page load', async () => {
    const wrapper = await show()
    expect(save).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="runtime-git-save-attempt-1"]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Saved request')
    expect(wrapper.text()).toContain('bbbbbbbb')
    const stored = useProjectStore().getProject(project.id)
    expect(stored.files['content/existing']).toBe('keep')
    expect(JSON.parse(stored.files[buildRuntimeRecord(deployment, attempt, scope).path]).request).toEqual(operation.request)
  })

  it('automatically records a newly started operation and its later terminal result', async () => {
    const wrapper = await show({ newAttempt: attempt })
    expect(save).toHaveBeenCalledOnce()
    const done = { ...attempt, state: 'succeeded', operation_result: { desired_reached: true, partial: false } }
    await wrapper.setProps({ attempts: [done] })
    await flushPromises()
    expect(save).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Saved result')
    const stored = useProjectStore().getProject(project.id)
    expect(stored.files).toHaveProperty(buildRuntimeRecord(deployment, attempt, scope).path)
    expect(stored.files).toHaveProperty(buildRuntimeRecord(deployment, done, scope).path)
  })

  it('shows Git failure separately and retries without repeating the live operation', async () => {
    save.mockRejectedValueOnce(new Error('Branch changed; retry'))
    const wrapper = await show({ newAttempt: attempt })
    expect(wrapper.get('[role="alert"]').text()).toContain('Branch changed')
    expect(useProjectStore().getProject(project.id).files[buildRuntimeRecord(deployment, attempt, scope).path]).toBeDefined()
    expect(useProjectStore().getProject(project.id).runtime_git_receipts).toBeUndefined()
    await wrapper.get('[data-testid="runtime-git-save-attempt-1"]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Saved request')
  })

  it('explains an unavailable matching project without selecting another repository', async () => {
    localStorage.removeItem('range42_project_registrations')
    const wrapper = await show({ newAttempt: attempt })
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Open the project')
    expect(wrapper.find('[data-testid="runtime-git-save-attempt-1"]').exists()).toBe(false)
  })

  it('does not add pending files to a different authored scenario in the registered project', async () => {
    useProjectStore().updateProject(project.id, { scenario: { label: 'different' } })
    await show({ newAttempt: attempt })
    expect(useProjectStore().getProject(project.id).files).toEqual(project.files)
    expect(save).not.toHaveBeenCalled()
  })

  it('does not update a new repository binding or show stale status after a backend switch', async () => {
    let resolve
    save.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const wrapper = await show({ newAttempt: attempt })
    const pendingFiles = { ...useProjectStore().getProject(project.id).files }
    useProjectStore().updateProject(project.id, { git: { ...project.git, repo_name: 'other' } })
    const backend = useBackendApiStore()
    backend.setActiveHost(backend.addHost({ url: 'https://elsewhere.test' }))
    resolve({ ...buildRuntimeRecord(deployment, attempt, scope), commit_sha: 'b'.repeat(40), expected_head: 'a'.repeat(40), branch: 'range42-ui/project-1' })
    await flushPromises()
    expect(useProjectStore().getProject(project.id).files).toEqual(pendingFiles)
    expect(useProjectStore().getProject(project.id).runtime_git_receipts).toBeUndefined()
    expect(wrapper.text()).not.toContain('Saved request')
  })

  it('resumes result recording after reload when the accepted request was already saved', async () => {
    const first = await show({ newAttempt: attempt })
    first.unmount()
    save.mockClear()
    const done = { ...attempt, state: 'failed', operation_result: { desired_reached: false, partial: true } }
    const wrapper = await show({ attempts: [done] })
    expect(save).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Saved result')
  })

  it('does not commit remotely if the pending record cannot fit in browser storage', async () => {
    const update = vi.spyOn(useProjectStore(), 'updateProject').mockImplementation(() => { throw new Error('Browser storage is full') })
    const wrapper = await show({ newAttempt: attempt })
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('Browser storage is full')
    update.mockRestore()
  })

  it('preserves a locally edited record instead of replacing it during automatic save', async () => {
    const path = buildRuntimeRecord(deployment, attempt, scope).path
    useProjectStore().updateProject(project.id, { files: { ...project.files, [path]: 'manual edit' } })
    const wrapper = await show({ newAttempt: attempt })
    expect(save).not.toHaveBeenCalled()
    expect(useProjectStore().getProject(project.id).files[path]).toBe('manual edit')
    expect(wrapper.get('[role="alert"]').text()).toMatch(/review/i)
  })
})
