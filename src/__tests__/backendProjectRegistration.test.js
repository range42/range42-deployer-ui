import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureBackendProject, latestSavedProjectRevision, registeredLocalProject } from '@/services/backendProjectRegistration'

const { request, state } = vi.hoisted(() => ({ request: vi.fn(), state: { scope: 'https://backend-a.test' } }))
vi.mock('@/services/backendApi', () => ({ backendRequest: request, getBackendScope: () => state.scope }))
const project = () => ({ id: 'browser-1', name: 'Demo', git: { source_id: 'git-source', repo_owner: 'team', repo_name: 'lab',
  provider: 'gitlab', base_url: 'https://git.example.test', branch_strategy: 'dedicated_repo', subdir: '',
  branch: 'main', working_branch: 'range42-ui/browser-1', token: 'must-never-serialize' } })
beforeEach(() => {
  localStorage.clear()
  state.scope = 'https://backend-a.test'
  request.mockReset().mockImplementation(async (path, options) => ({ id: path.split('/').at(-1), ...JSON.parse(options.body) }))
})

describe('backend project registration', () => {
  it('registers only the repository contract and reuses its ID across saves', async () => {
    const saved = project()
    const first = await ensureBackendProject(saved)
    saved.name = 'Renamed'
    const second = await ensureBackendProject(saved)
    expect(second.id).toBe(first.id)
    expect(request.mock.calls[0]).toEqual(['/v1/projects/browser-1', { method: 'PUT', body: JSON.stringify({
      name: 'Demo', source_id: 'git-source', branch_strategy: 'dedicated_repo', repo_owner: 'team', repo_name: 'lab', subdir: '',
    }) }])
    expect(JSON.stringify(request.mock.calls)).not.toContain('must-never-serialize')
    expect(localStorage.getItem('range42_project_registrations')).not.toContain('must-never-serialize')
  })

  it('registers a new identity if the previous repository binding has deployments', async () => {
    request.mockRejectedValueOnce(Object.assign(new Error('binding in use'), { code: 'PROJECT_BINDING_IN_USE', status: 409 }))
    const result = await ensureBackendProject(project())
    expect(result.id).not.toBe('browser-1')
    expect(result.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/)
    const again = await ensureBackendProject(project())
    expect(again.id).toBe(result.id)
  })

  it('keeps registration mappings separate by backend and selected fork binding', async () => {
    const saved = project()
    const first = await ensureBackendProject(saved)
    saved.git.repo_owner = 'personal-fork'
    await ensureBackendProject(saved)
    state.scope = 'https://backend-b.test'
    saved.git.repo_owner = 'team'
    await ensureBackendProject(saved)
    const records = JSON.parse(localStorage.getItem('range42_project_registrations'))
    expect(Object.keys(records)).toHaveLength(3)
    state.scope = 'https://backend-a.test'
    expect((await ensureBackendProject(saved)).id).toBe(first.id)
  })

  it('does not use a registration result after the backend changes while registering', async () => {
    request.mockImplementationOnce(async () => { state.scope = 'https://backend-b.test'; return { id: 'wrong-backend' } })
    await expect(ensureBackendProject(project())).rejects.toThrow(/backend changed/i)
    expect(localStorage.getItem('range42_project_registrations')).toBeNull()
  })

  it('finds a saved configure revision only for the currently registered backend and repository', async () => {
    const saved = { ...project(), head_sha: 'd'.repeat(40) }
    const result = await ensureBackendProject(saved)
    localStorage.setItem('range42_projects', JSON.stringify([saved]))
    expect(latestSavedProjectRevision(result.id)).toBe(saved.head_sha)
    state.scope = 'https://backend-b.test'
    expect(latestSavedProjectRevision(result.id)).toBe('')
    state.scope = 'https://backend-a.test'
    saved.git.repo_name = 'other'
    localStorage.setItem('range42_projects', JSON.stringify([saved]))
    expect(latestSavedProjectRevision(result.id)).toBe('')
  })

  it('finds one exact registered local project, rejecting stale or ambiguous mappings', async () => {
    const saved = project()
    const result = await ensureBackendProject(saved)
    expect(registeredLocalProject(result.id, [saved], state.scope)).toBe(saved)
    expect(registeredLocalProject(result.id, [saved], 'https://backend-b.test')).toBeNull()
    const changed = { ...saved, git: { ...saved.git, repo_owner: 'other-fork' } }
    expect(registeredLocalProject(result.id, [changed], state.scope)).toBeNull()
    expect(registeredLocalProject(result.id, [saved, { ...saved }], state.scope)).toBeNull()
  })
})
