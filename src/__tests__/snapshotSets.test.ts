import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotClient } from '@/services/snapshotSets'

const fixture = vi.hoisted(() => ({ backend: { url: 'https://backend.test', token: 'private-token', activeHost: { id: 'backend' } }, request: vi.fn() }))
vi.mock('@/stores/backendApiStore', () => ({ useBackendApiStore: () => fixture.backend }))
vi.mock('@/services/backendApi', () => ({ getBackendScope: () => fixture.backend.url, backendRequest: fixture.request }))
const context = { deploymentId: 'dep', projectSha: 'a'.repeat(40), hostId: 'host' }
const member = () => ({ vm_id: 60000, vm_name: 'guest', uuid: '00000000-0000-4000-8000-000000000001', config_digest: 'c'.repeat(64), restore_digest: 'd'.repeat(64), status: 'stopped' })
const snapshot = () => ({ id: 'a'.repeat(32), deployment_id: 'dep', project_sha: context.projectSha, host_id: 'host',
  target_digest: 'b'.repeat(64), native_name: 'r42s_' + 'a'.repeat(24), name: 'Checkpoint', description: '', state: 'planned',
  atomic: false, vmstate: false, created_at: '2026-09-14T10:00:00Z', members: [member()],
  operation: { id: 'b'.repeat(32), kind: 'create', state: 'planned', recovery: 'none', plan_digest: 'e'.repeat(64),
    expires_at: new Date(Date.now() + 300000).toISOString(), reviewed_members: [member()], members: [{ vm_id: 60000, state: 'planned' }] }, operations: [] })

beforeEach(() => { fixture.request.mockReset(); fixture.backend.token = 'private-token'; fixture.backend.url = 'https://backend.test'; fixture.backend.activeHost.id = 'backend' })

describe('reviewed snapshot-set client', () => {
  it('plans separately and sends only the reviewed digest once on explicit execution', async () => {
    const client = createSnapshotClient(context)
    fixture.request.mockResolvedValue(snapshot())
    const review = await client.planCreate('Checkpoint', '')
    expect(fixture.request).toHaveBeenCalledTimes(1)
    expect(fixture.request.mock.calls[0][0]).toBe('/v1/deployments/dep/snapshot-sets/plan')
    const accepted = snapshot(); accepted.operation.state = 'running'; accepted.operation.recovery = 'poll_saved_tasks'; accepted.state = 'creating'
    fixture.request.mockResolvedValue(accepted)
    await client.execute(review)
    expect(JSON.parse(fixture.request.mock.calls[1][1].body)).toEqual({ plan_digest: 'e'.repeat(64) })
    expect(JSON.stringify(fixture.request.mock.calls)).not.toContain('private-token')
  })

  it('refuses expired review before a mutation', async () => {
    const client = createSnapshotClient(context), review = snapshot()
    review.operation.expires_at = '2000-01-01T00:00:00Z'
    await expect(client.execute(review)).rejects.toThrow()
    expect(fixture.request).not.toHaveBeenCalled()
  })

  it.each(['deployment_id', 'host_id', 'project_sha'])('refuses a plan for another %s', async field => {
    const client = createSnapshotClient(context), bad = snapshot()
    Object.assign(bad, { [field]: field === 'project_sha' ? 'f'.repeat(40) : 'other' })
    fixture.request.mockResolvedValue(bad)
    await expect(client.planCreate('Checkpoint', '')).rejects.toThrow()
    expect(fixture.request).toHaveBeenCalledTimes(1)
  })

  it('rejects token changes during response processing and never dispatches with replacement credentials', async () => {
    const client = createSnapshotClient(context)
    fixture.request.mockImplementation(async () => { fixture.backend.token = 'replacement'; return snapshot() })
    await expect(client.planCreate('Checkpoint', '')).rejects.toThrow()
    await expect(client.execute(snapshot())).rejects.toThrow()
    expect(fixture.request).toHaveBeenCalledTimes(1)
  })

  it('requires exact set and target fingerprint when confirming an accepted write', async () => {
    const client = createSnapshotClient(context), other = snapshot()
    other.target_digest = 'f'.repeat(64)
    fixture.request.mockResolvedValue(other)
    await expect(client.execute(snapshot())).rejects.toThrow()
  })

  it('does not automatically dispatch retention candidates or retry an unknown result', async () => {
    const client = createSnapshotClient(context), candidate = snapshot(); candidate.operation.kind = 'delete'
    fixture.request.mockResolvedValue({ policy: { keep_count: 5, keep_days: 7 }, automatic_enforcement: false, eligible_count: 1, candidates: [candidate] })
    const review = await client.planRetention()
    expect(review.candidates).toHaveLength(1)
    expect(fixture.request).toHaveBeenCalledTimes(1)
    fixture.request.mockRejectedValue(new Error('raw secret upstream text'))
    await expect(client.execute(candidate)).rejects.toThrow('could not be confirmed')
    expect(fixture.request).toHaveBeenCalledTimes(2)
  })
  it('rejects a create review that actually describes deletion', async () => {
    const client = createSnapshotClient(context), wrong = snapshot(); wrong.operation.kind = 'delete'
    fixture.request.mockResolvedValue(wrong)
    await expect(client.planCreate('Checkpoint', '')).rejects.toThrow()
  })

  it('labels malformed accepted responses as unconfirmed rather than safe to repeat', async () => {
    const client = createSnapshotClient(context)
    fixture.request.mockResolvedValue({})
    await expect(client.execute(snapshot())).rejects.toThrow('could not be confirmed')
    expect(fixture.request).toHaveBeenCalledTimes(1)
  })

})
