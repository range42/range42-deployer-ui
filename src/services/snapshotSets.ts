/** Reviewed snapshot-set API. Captured credentials/context never enter public records. */
import { backendRequest, getBackendScope } from './backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

export interface SnapshotContext { deploymentId: string; projectSha: string; hostId: string }
export type SnapshotKind = 'create' | 'rollback' | 'delete'
export interface SnapshotMember { vm_id: number; vm_name: string; uuid: string; config_digest: string; restore_digest: string; status: 'running' | 'stopped' }
export interface SnapshotOutcome { vm_id: number; state: string; code?: string; upid?: string }
export interface SnapshotOperation { id: string; kind: SnapshotKind; state: string; recovery: 'none' | 'poll_saved_tasks' | 'operator_required'; plan_digest: string; expires_at: string; reviewed_members: SnapshotMember[]; members: SnapshotOutcome[]; attempt_id?: string }
export interface SnapshotSet { id: string; deployment_id: string; project_sha: string; host_id: string; target_digest: string; native_name: string; name: string; description: string; state: string; created_at: string; atomic: false; vmstate: false; members: SnapshotMember[]; operation: SnapshotOperation }
export interface SnapshotPage { items: SnapshotSet[]; total: number; offset: number; limit: number }
export interface RetentionReview { policy: { keep_count: number; keep_days: number }; automatic_enforcement: false; eligible_count: number; candidates: SnapshotSet[] }
export class SnapshotRequestError extends Error {
  constructor(public reason: 'context' | 'invalid' | 'stale' | 'auth' | 'blocked' | 'unconfirmed') {
    super(reason === 'unconfirmed' ? 'The snapshot request outcome could not be confirmed.' : `Snapshot request refused: ${reason}`)
  }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const hex = (v: unknown, length: number): v is string => typeof v === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(v)
const sha = (v: unknown): v is string => hex(v, 40) || hex(v, 64)
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v)
const date = (v: unknown): v is string => text(v, 64) && Number.isFinite(Date.parse(v))
const vmid = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 100 && Number(v) <= 999999999
const oneOf = (v: unknown, list: string[]) => typeof v === 'string' && list.includes(v)
const outcomes = ['planned', 'dispatching', 'accepted', 'unconfirmed', 'not_started', 'failed', 'succeeded']
const operationStates = ['planned', 'running', 'needs_review', 'succeeded', 'partial', 'failed', 'cancelled', 'superseded']
const setStates = ['planned', 'creating', 'rolling_back', 'deleting', 'needs_review', 'complete', 'partial', 'failed', 'deleted']
function member(value: unknown): value is SnapshotMember {
  return record(value) && vmid(value.vm_id) && text(value.vm_name) && typeof value.uuid === 'string'
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.uuid)
    && hex(value.config_digest, 64) && hex(value.restore_digest, 64) && oneOf(value.status, ['running', 'stopped'])
}
function members(value: unknown): value is SnapshotMember[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 64 && value.every(member)
    && new Set(value.map(vm => vm.vm_id)).size === value.length
}
function validSet(value: unknown): value is SnapshotSet {
  if (!record(value) || !hex(value.id, 32) || !identifier(value.deployment_id) || !sha(value.project_sha)
    || !identifier(value.host_id) || !hex(value.target_digest, 64) || !text(value.native_name, 64)
    || !text(value.name, 128) || typeof value.description !== 'string' || value.description.length > 1024
    || !oneOf(value.state, setStates) || !date(value.created_at) || value.atomic !== false || value.vmstate !== false || !members(value.members)) return false
  const op = value.operation
  if (!record(op) || !hex(op.id, 32) || !oneOf(op.kind, ['create', 'rollback', 'delete']) || !oneOf(op.state, operationStates)
    || !oneOf(op.recovery, ['none', 'poll_saved_tasks', 'operator_required']) || !hex(op.plan_digest, 64) || !date(op.expires_at)
    || !members(op.reviewed_members) || !Array.isArray(op.members) || op.members.length !== op.reviewed_members.length
    || !op.members.every(row => record(row) && vmid(row.vm_id) && oneOf(row.state, outcomes))
    || new Set(op.members.map(row => row.vm_id)).size !== op.members.length) return false
  const originals = value.members, reviewed = op.reviewed_members, results = op.members
  return reviewed.every(vm => originals.some(original => original.vm_id === vm.vm_id && original.uuid === vm.uuid)
    && results.some(row => row.vm_id === vm.vm_id))
}
function requireValue(condition: unknown, reason: ConstructorParameters<typeof SnapshotRequestError>[0] = 'invalid'): asserts condition {
  if (!condition) throw new SnapshotRequestError(reason)
}

export function createSnapshotClient(context: SnapshotContext, assertCurrent = () => {}) {
  const backend = useBackendApiStore(), url = getBackendScope(), token = backend.token, backendId = backend.activeHost?.id
  const target = { ...context }
  requireValue(identifier(target.deploymentId) && sha(target.projectSha) && identifier(target.hostId) && !!url)
  const base = `/v1/deployments/${encodeURIComponent(target.deploymentId)}/snapshot-sets`
  function guard() {
    requireValue(getBackendScope() === url && backend.token === token && backend.activeHost?.id === backendId, 'context')
    assertCurrent()
  }
  async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    guard()
    try {
      const result = await backendRequest<unknown>(base + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      guard()
      return result
    } catch (cause) {
      guard()
      if (cause instanceof SnapshotRequestError) throw cause
      const status = record(cause) ? cause.status : undefined
      throw new SnapshotRequestError(status === 401 || status === 403 ? 'auth' : status === 409 ? 'blocked' : 'unconfirmed')
    }
  }
  function checked(value: unknown, current = true): SnapshotSet {
    requireValue(validSet(value) && value.deployment_id === target.deploymentId)
    if (current) requireValue(value.project_sha === target.projectSha && value.host_id === target.hostId, 'context')
    return value
  }
  const setPath = (set: SnapshotSet) => { checked(set); return `/${set.id}` }
  return {
    guard,
    async list(offset = 0): Promise<SnapshotPage> {
      requireValue(Number.isInteger(offset) && offset >= 0 && offset <= 100000)
      const body = await request(`?offset=${offset}&limit=20`)
      requireValue(record(body) && Array.isArray(body.items) && body.items.length <= 20 && Number.isInteger(body.total)
        && Number(body.total) >= 0 && body.offset === offset && body.limit === 20)
      return { items: body.items.map(item => checked(item, false)), total: Number(body.total), offset, limit: 20 }
    },
    async planCreate(name: string, description: string) {
      requireValue(name.trim().length > 0 && name.length <= 128 && description.length <= 1024)
      const result = checked(await request('/plan', 'POST', { name: name.trim(), description, vmstate: false }))
      requireValue(result.operation.kind === 'create' && result.operation.state === 'planned')
      return result
    },
    async planExisting(set: SnapshotSet, kind: 'rollback' | 'delete') {
      const result = checked(await request(`${setPath(set)}/${kind}/plan`, 'POST'))
      requireValue(result.id === set.id && result.target_digest === set.target_digest && result.operation.kind === kind && result.operation.state === 'planned')
      return result
    },
    async execute(review: SnapshotSet) {
      guard(); checked(review)
      requireValue(review.operation.state === 'planned' && Date.parse(review.operation.expires_at) > Date.now(), 'stale')
      const response = await request(`${setPath(review)}/execute`, 'POST', { plan_digest: review.operation.plan_digest })
      try {
        const result = checked(response)
        requireValue(result.id === review.id && result.target_digest === review.target_digest && result.operation.id === review.operation.id
          && result.operation.plan_digest === review.operation.plan_digest && ['running', 'needs_review', 'succeeded', 'partial', 'failed'].includes(result.operation.state))
        return result
      } catch { throw new SnapshotRequestError('unconfirmed') }
    },
    async reconcile(set: SnapshotSet) {
      const result = checked(await request(`${setPath(set)}/reconcile`, 'POST'))
      requireValue(result.id === set.id && result.target_digest === set.target_digest)
      return result
    },
    async cancel(review: SnapshotSet) {
      guard(); requireValue(review.operation.state === 'planned', 'stale')
      await request(`${setPath(review)}/plans/${review.operation.id}`, 'DELETE')
    },
    async planRetention(): Promise<RetentionReview> {
      const body = await request('/retention/plan?limit=20', 'POST')
      requireValue(record(body) && record(body.policy) && Number.isInteger(body.policy.keep_count) && Number(body.policy.keep_count) >= 0
        && Number.isInteger(body.policy.keep_days) && Number(body.policy.keep_days) >= 0 && body.automatic_enforcement === false
        && Number.isInteger(body.eligible_count) && Number(body.eligible_count) >= 0 && Array.isArray(body.candidates) && body.candidates.length <= 20)
      const candidates = body.candidates.map(candidate => checked(candidate))
      requireValue(candidates.every(candidate => candidate.operation.kind === 'delete' && candidate.operation.state === 'planned'))
      return { policy: { keep_count: Number(body.policy.keep_count), keep_days: Number(body.policy.keep_days) }, automatic_enforcement: false,
        eligible_count: Number(body.eligible_count), candidates }
    },
  }
}
