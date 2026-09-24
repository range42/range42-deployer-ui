import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureBackendProject } from '@/services/backendProjectRegistration'
import { buildRuntimeRecord, saveRuntimeRecord, verifyRuntimeRecordReceipt } from '@/services/runtimeGitRecords'

const { state, provider } = vi.hoisted(() => ({ state: { scope: 'https://backend.test', files: {}, head: 'a'.repeat(40) }, provider: {} }))
vi.mock('@/services/backendApi', () => ({ getBackendScope: () => state.scope,
  backendRequest: async (path, options) => ({ id: path.split('/').at(-1), ...JSON.parse(options.body) }) }))
vi.mock('@/services/git', () => ({ getProvider: () => provider }))
vi.mock('@/stores/inventoryStore', () => ({ useInventoryStore: () => ({ getToken: () => null,
  getSource: () => ({ id: 'source-1', provider: 'github', base_url: 'https://github.com' }) }) }))

const project = () => ({ id: 'browser-1', name: 'Lab', scenario: { label: 'demo' }, head_sha: 'a'.repeat(40),
  git: { source_id: 'source-1', provider: 'github', base_url: 'https://github.com', repo_owner: 'team', repo_name: 'lab',
    branch_strategy: 'dedicated_repo', branch: 'main', working_branch: 'range42-ui/browser-1', subdir: 'projects/demo' } })
const deployment = () => ({ id: 'deployment-1', project_id: 'browser-1', scenario_label: 'demo', target_host_id: 'host-1' })
const attempt = () => ({ id: 'attempt-1', deployment_id: 'deployment-1', state: 'deploying', project_sha: 'b'.repeat(40),
  created_at: '2026-09-10T12:00:00Z', operation: { project_sha: 'b'.repeat(40), target_host_id: 'host-1',
    request: { kind: 'sdn_snat', vnet: 'labnet', enabled: false, acknowledge_shared_scope: true },
    runtime: { proof: 'private-runtime-proof' }, target_identity: { password: 'private-password' } },
  sub_reason: 'private-runner-output', operation_result: null })

beforeEach(async () => {
  localStorage.clear()
  state.scope = 'https://backend.test'
  state.head = 'a'.repeat(40)
  state.files = { 'projects/demo/meta.json': JSON.stringify({ name: 'Remote latest title', ui_files: ['content/existing.txt'], future_field: 42 }),
    'projects/demo/content/existing.txt': 'keep me', 'unrelated.txt': 'remote edit' }
  provider.canWrite = vi.fn(async () => true)
  provider.listCommits = vi.fn(async () => [{ sha: state.head }])
  provider.getFile = vi.fn(async ({ path }) => {
    if (!Object.hasOwn(state.files, path)) throw new Error(`GitHub GET https://api.github.com/repos/team/lab/contents/${path} -> 404 missing file`)
    return { content: state.files[path], sha: `blob-${path}` }
  })
  provider.commitFiles = vi.fn(async ({ expectedHead, files }) => {
    if (expectedHead !== state.head) throw new Error('Branch changed; retry')
    for (const file of files) state.files[file.path] = file.content
    state.head = 'c'.repeat(40)
    return { sha: state.head }
  })
  await ensureBackendProject(project())
})

describe('runtime change records in project Git', () => {
  it.each([
    '2026-09-24T20:15:48.356086',
    '2026-09-24T20:15:48.356086Z',
    '2026-09-24T22:15:48.356086+02:00',
  ])('records UTC result timestamps for %s independently of the browser timezone', ended_at => {
    const record = buildRuntimeRecord(deployment(), { ...attempt(), state: 'succeeded', ended_at }, state.scope)
    expect(JSON.parse(record.content)).toMatchObject({ version: 2, ended_at: '2026-09-24T20:15:48.356Z' })
    expect(record.path).toBe('scenarios/demo/runtime/deployment-1/attempt-1/result.json')
  })

  function savedLegacyResult() {
    const current = { ...attempt(), state: 'succeeded', ended_at: '2026-09-24T20:15:48.356086', rc: 0,
      operation_result: { desired_reached: true, partial: false } }
    const record = buildRuntimeRecord(deployment(), current, state.scope)
    const content = `${JSON.stringify({ ...JSON.parse(record.content), version: 1, ended_at: '2026-09-24T18:15:48.356Z' }, null, 2)}\n`
    const saved = { ...project(), files: { [record.path]: content },
      runtime_git_receipts: { [JSON.stringify([state.scope, record.path])]: 'd'.repeat(40) } }
    state.files[`projects/demo/${record.path}`] = content
    return { current, record, content, saved }
  }

  it('verifies a legacy result at its saved Git receipt without rewriting it or checking write access', async () => {
    const { current, record, content, saved } = savedLegacyResult()
    const result = await verifyRuntimeRecordReceipt(saved, deployment(), current, state.scope)
    expect(result).toMatchObject({ path: record.path, content, phase: 'result', commit_sha: 'd'.repeat(40) })
    expect(provider.getFile).toHaveBeenCalledExactlyOnceWith({ owner: 'team', repo: 'lab',
      path: `projects/demo/${record.path}`, ref: 'd'.repeat(40) })
    expect(provider.canWrite).not.toHaveBeenCalled()
    expect(provider.listCommits).not.toHaveBeenCalled()
    expect(provider.commitFiles).not.toHaveBeenCalled()
    expect(saved.files[record.path]).toBe(content)
  })

  it('rejects a timestamp-only local edit when the immutable Git receipt differs', async () => {
    const { current, record, saved } = savedLegacyResult()
    saved.files[record.path] = saved.files[record.path].replace('18:15:48', '19:15:48')
    await expect(verifyRuntimeRecordReceipt(saved, deployment(), current, state.scope)).rejects.toThrow(/does not match/i)
    expect(provider.commitFiles).not.toHaveBeenCalled()
    expect(saved.files[record.path]).toContain('19:15:48')
  })

  it.each(['request', 'result', 'deployment_id', 'backend_url'])('rejects changed legacy %s even when the receipt contains those bytes', async field => {
    const { current, record, saved } = savedLegacyResult()
    const changed = JSON.parse(saved.files[record.path])
    changed[field] = field === 'request' ? { ...changed.request, enabled: true }
      : field === 'result' ? { ...changed.result, desired_reached: false } : 'other'
    saved.files[record.path] = `${JSON.stringify(changed, null, 2)}\n`
    state.files[`projects/demo/${record.path}`] = saved.files[record.path]
    await expect(verifyRuntimeRecordReceipt(saved, deployment(), current, state.scope)).rejects.toThrow(/legacy|local runtime record/i)
    expect(provider.getFile).not.toHaveBeenCalled()
    expect(provider.commitFiles).not.toHaveBeenCalled()
  })

  it('preserves a legacy pending result without a receipt instead of treating it as verified', async () => {
    const { current, saved } = savedLegacyResult()
    delete saved.runtime_git_receipts
    await expect(verifyRuntimeRecordReceipt(saved, deployment(), current, state.scope)).rejects.toThrow(/receipt/i)
    expect(provider.getFile).not.toHaveBeenCalled()
    expect(provider.commitFiles).not.toHaveBeenCalled()
  })

  it('retains an existing legacy Git result when a new canonical result would collide', async () => {
    const { current, content, record } = savedLegacyResult()
    await expect(saveRuntimeRecord(project(), deployment(), current, state.scope)).rejects.toThrow(/different record/i)
    expect(state.files[`projects/demo/${record.path}`]).toBe(content)
    expect(provider.commitFiles).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'firewall_alias', scope: 'vm', vm_id: 3191, action: 'rename', name: 'clients', new_name: 'students' },
    { kind: 'firewall_rule', scope: 'node', action: 'move', position: 3, move_to: 1 },
    { kind: 'firewall_rule', scope: 'vm', vm_id: 3191, action: 'create', name: 'web',
      rule: { direction: 'in', action: 'ACCEPT', protocol: 'tcp', destination_port: '443', source: '10.42.0.0/24', destination: null, enabled: true } },
  ])('records reviewed $kind without copying arbitrary metadata', input => {
    const current = attempt()
    current.operation.request = { ...input, acknowledge_shared_scope: true, review_fingerprint: 'a'.repeat(64), private_context: 'do not save' }
    const record = buildRuntimeRecord(deployment(), current, state.scope)
    expect(JSON.parse(record.content).request).toEqual({ ...input, acknowledge_shared_scope: true })
    expect(record.content).not.toMatch(/private_context|do not save|review_fingerprint/)
  })
  it.each([{ kind: 'runtime_observe' }, { kind: 'host_firewall', enabled: true, acknowledge_shared_scope: true, review_fingerprint: 'a'.repeat(64) },
    { kind: 'sdn_network', action: 'delete', vnet: 'r42blue', acknowledge_shared_scope: true, review_fingerprint: 'a'.repeat(64) }])('records scoped native request $kind without private review data', request => {
    const current = attempt()
    current.operation.request = request
    const record = buildRuntimeRecord(deployment(), current, state.scope)
    expect(JSON.parse(record.content).request.kind).toBe(request.kind)
    expect(record.content).not.toContain('review_fingerprint')
  })
  it('records exact accepted intent without private runtime details or log messages', () => {
    const record = buildRuntimeRecord(deployment(), attempt(), state.scope)
    expect(record.path).toBe('scenarios/demo/runtime/deployment-1/attempt-1/request.json')
    expect(JSON.parse(record.content)).toEqual({ version: 1, phase: 'request', backend_url: state.scope,
      deployment_id: 'deployment-1', attempt_id: 'attempt-1', project_sha: 'b'.repeat(40), target_host_id: 'host-1',
      request: { kind: 'sdn_snat', vnet: 'labnet', enabled: false, acknowledge_shared_scope: true } })
    expect(record.content).not.toMatch(/private-|password|proof/)
    expect(buildRuntimeRecord(deployment(), { ...attempt(), state: 'pending' }, state.scope)).toEqual(record)
  })

  it('retains partial and failed outcomes separately from accepted intent', () => {
    const record = buildRuntimeRecord(deployment(), { ...attempt(), state: 'failed',
      operation_result: { desired_reached: false, partial: true, matched_vmids: [3101], missing_vmids: [3102],
        mismatched_vmids: [], live_forwarding_verified: false, error: 'private-runner-output', observed: { token: 'private-token' } } }, state.scope)
    expect(record.path).toMatch(/result.json$/)
    expect(JSON.parse(record.content)).toMatchObject({ state: 'failed', result: { desired_reached: false, partial: true,
      matched_vmids: [3101], missing_vmids: [3102], mismatched_vmids: [], live_forwarding_verified: false, error_present: true } })
    expect(record.content).not.toContain('private-')
  })

  it.each(['succeeded', 'completed', 'partial', 'failed', 'cancelled', 'unknown'])('records the backend terminal state %s without reclassifying it', state => {
    const record = buildRuntimeRecord(deployment(), { ...attempt(), state }, 'https://backend.test')
    expect(record.phase).toBe('result')
    expect(JSON.parse(record.content).state).toBe(state)
  })

  it('appends only the record and remote file index in one guarded commit', async () => {
    const saved = await saveRuntimeRecord(project(), deployment(), attempt(), state.scope)
    expect(saved).toMatchObject({ branch: 'range42-ui/browser-1', commit_sha: 'c'.repeat(40), expected_head: 'a'.repeat(40) })
    expect(provider.commitFiles).toHaveBeenCalledOnce()
    const call = provider.commitFiles.mock.calls[0][0]
    expect(call).toMatchObject({ owner: 'team', repo: 'lab', branch: 'range42-ui/browser-1', expectedHead: 'a'.repeat(40) })
    expect(call.files.map(file => file.path)).toEqual(['projects/demo/meta.json', `projects/demo/${saved.path}`])
    expect(JSON.parse(state.files['projects/demo/meta.json'])).toEqual({ name: 'Remote latest title', future_field: 42,
      ui_files: ['content/existing.txt', saved.path] })
    expect(state.files['unrelated.txt']).toBe('remote edit')
    expect(provider.getFile.mock.calls.every(([query]) => query.ref === 'a'.repeat(40))).toBe(true)
  })

  it('reuses an identical saved record without another commit', async () => {
    await saveRuntimeRecord(project(), deployment(), attempt(), state.scope)
    await saveRuntimeRecord(project(), deployment(), attempt(), state.scope)
    expect(provider.commitFiles).toHaveBeenCalledOnce()
  })

  it('refuses a conflicting existing receipt or another backend using the same identifiers', async () => {
    const record = buildRuntimeRecord(deployment(), attempt(), state.scope)
    state.files[`projects/demo/${record.path}`] = record.content.replace('https://backend.test', 'https://different.test')
    await expect(saveRuntimeRecord(project(), deployment(), attempt(), state.scope)).rejects.toThrow(/different record/i)
    expect(provider.commitFiles).not.toHaveBeenCalled()
  })

  it('fails a branch race without replacing another writer’s changes', async () => {
    provider.commitFiles.mockImplementationOnce(async () => { state.head = 'd'.repeat(40); throw new Error('Branch changed; retry') })
    await expect(saveRuntimeRecord(project(), deployment(), attempt(), state.scope)).rejects.toThrow(/branch changed/i)
    expect(state.files['unrelated.txt']).toBe('remote edit')
    expect(Object.keys(state.files)).toHaveLength(3)
  })

  it.each([
    ['another backend', saved => saved, 'https://elsewhere.test'],
    ['another repository', saved => ({ ...saved, git: { ...saved.git, repo_name: 'other' } })],
    ['another scenario', saved => ({ ...saved, scenario: { label: 'other' } })],
    ['the base branch', saved => ({ ...saved, git: { ...saved.git, working_branch: 'main' } })],
    ['an unsafe subdirectory', saved => ({ ...saved, git: { ...saved.git, subdir: '../elsewhere' } })],
  ])('does not write to %s', async (_label, change, scope = state.scope) => {
    await expect(saveRuntimeRecord(change(project()), deployment(), attempt(), scope)).rejects.toThrow()
    expect(provider.commitFiles).not.toHaveBeenCalled()
  })

  it.each([
    { deployment_id: 'other' }, { operation: { ...attempt().operation, target_host_id: 'other' } },
    { operation: { ...attempt().operation, request: { kind: 'vm_firewall', vm_id: '../other', enabled: true } } },
    { operation: { ...attempt().operation, request: { kind: 'sdn_snat', vnet: 'labnet', enabled: 'false' } } },
  ])('rejects unbound or malformed operation data', async patch => {
    await expect(saveRuntimeRecord(project(), deployment(), { ...attempt(), ...patch }, state.scope)).rejects.toThrow()
    expect(provider.commitFiles).not.toHaveBeenCalled()
  })

  it('does not treat authentication failure as a missing record', async () => {
    provider.getFile.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }))
    await expect(saveRuntimeRecord(project(), deployment(), attempt(), state.scope)).rejects.toThrow(/unauthorized/)
    expect(provider.commitFiles).not.toHaveBeenCalled()
  })

  it('captures provider and repository before waiting and never follows a changed binding', async () => {
    const original = project()
    let resume
    provider.canWrite.mockImplementationOnce(() => new Promise(resolve => { resume = resolve }))
    const operation = saveRuntimeRecord(original, deployment(), attempt(), state.scope)
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'))
    original.git.repo_name = 'new-repo'
    state.scope = 'https://another-backend.test'
    resume(true)
    await operation
    expect(provider.commitFiles.mock.calls[0][0].repo).toBe('lab')
  })
})
