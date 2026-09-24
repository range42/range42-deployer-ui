import { providerForBinding, runOnBranch, workingBranchForProject } from '@/composables/useProjectGitSync'
import { registeredLocalProject } from './backendProjectRegistration'

const terminal = new Set(['succeeded', 'completed', 'partial', 'failed', 'cancelled', 'unknown'])
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
const vmid = value => Number.isInteger(value) && value >= 100 && value <= 999999999
const policyKinds = ['firewall_alias', 'firewall_rule']
const namePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const position = value => Number.isInteger(value) && value >= 0 && value <= 4095

function policyRequest(input) {
  requireValue(['vm', 'node', 'datacenter'].includes(input.scope) && input.acknowledge_shared_scope === true
    && /^[a-f0-9]{64}$/.test(input.review_fingerprint) && (input.scope === 'vm' ? vmid(input.vm_id) : input.vm_id == null), 'Invalid firewall scope review')
  const result = { scope: input.scope, action: input.action }
  if (input.scope === 'vm') result.vm_id = input.vm_id
  if (input.kind === 'firewall_alias') {
    requireValue(input.scope !== 'node' && ['create', 'rename', 'delete'].includes(input.action) && namePattern.test(input.name), 'Invalid firewall alias')
    result.name = input.name
    if (input.action === 'create') {
      requireValue(typeof input.cidr === 'string' && input.cidr.length <= 128 && /^[0-9a-fA-F:.]+\/[0-9]{1,3}$/.test(input.cidr), 'Invalid alias CIDR')
      result.cidr = input.cidr
    } else if (input.action === 'rename') {
      requireValue(namePattern.test(input.new_name), 'Invalid alias name')
      result.new_name = input.new_name
    }
  } else {
    requireValue(['create', 'update', 'delete', 'move'].includes(input.action), 'Invalid firewall rule action')
    if (input.action === 'create') { requireValue(namePattern.test(input.name), 'Invalid rule name'); result.name = input.name }
    else { requireValue(position(input.position), 'Invalid rule position'); result.position = input.position }
    if (input.action === 'move') { requireValue(position(input.move_to), 'Invalid rule destination'); result.move_to = input.move_to }
    if (['create', 'update'].includes(input.action)) {
      const rule = input.rule
      requireValue(rule && ['in', 'out'].includes(rule.direction) && ['ACCEPT', 'DROP', 'REJECT'].includes(rule.action)
        && ['tcp', 'udp'].includes(rule.protocol) && typeof rule.enabled === 'boolean'
        && /^[0-9:,]{1,80}$/.test(rule.destination_port), 'Invalid firewall rule')
      result.rule = { direction: rule.direction, action: rule.action, protocol: rule.protocol, destination_port: rule.destination_port, enabled: rule.enabled }
      for (const key of ['source', 'destination']) {
        requireValue(rule[key] == null || (typeof rule[key] === 'string' && /^[A-Za-z0-9_:./-]{1,128}$/.test(rule[key])), 'Invalid rule address')
        result.rule[key] = rule[key] ?? null
      }
    }
  }
  return result
}

function requireValue(condition, message) { if (!condition) throw new Error(message) }
function utcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null
  // Older backend responses omit the UTC offset after SQLite deserialization.
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`
  return Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null
}
function safePath(path) {
  requireValue(typeof path === 'string' && path.length > 0 && !path.includes('\\')
    && Array.from(path).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    && path.split('/').every(part => part && !['.', '..', '.git'].includes(part)),
  'Invalid runtime record repository path')
  return path
}

/** A fixed schema deliberately excludes arbitrary logs, proofs and connection data. */
export function buildRuntimeRecord(deployment, attempt, scope) {
  const url = new URL(scope)
  requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
    'Choose a backend URL without credentials or query parameters')
  requireValue(identifier(deployment?.id) && identifier(attempt?.id) && attempt.deployment_id === deployment.id,
    'The runtime attempt does not belong to this deployment')
  requireValue(/^[a-z][a-z0-9_]{0,47}$/.test(deployment.scenario_label) && deployment.scenario_label !== '_universal',
    'Runtime records require a concrete scenario')
  const operation = attempt.operation
  requireValue(operation?.target_host_id === deployment.target_host_id && identifier(operation?.target_host_id)
    && shaPattern.test(operation?.project_sha) && (!attempt.project_sha || attempt.project_sha === operation.project_sha),
  'The runtime attempt has a different target or project revision')
  const input = operation.request
  requireValue(['runtime_observe', 'sdn_network', ...policyKinds].includes(input?.kind) || typeof input?.enabled === 'boolean', 'The runtime request must contain an explicit desired state')
  const request = { kind: input.kind }
  if (policyKinds.includes(input.kind)) {
    Object.assign(request, policyRequest(input))
  } else if (input.kind === 'vm_firewall') {
    requireValue(vmid(input.vm_id), 'Invalid runtime VM identifier')
    request.vm_id = input.vm_id
  } else if (input.kind === 'sdn_snat') {
    requireValue(/^[a-z][a-z0-9]{0,7}$/.test(input.vnet) && input.acknowledge_shared_scope === true, 'Invalid shared SDN request')
    request.vnet = input.vnet
  } else if (input.kind === 'sdn_network') {
    requireValue(/^[A-Za-z][A-Za-z0-9]{0,7}$/.test(input.vnet) && ['create', 'delete'].includes(input.action)
      && input.acknowledge_shared_scope === true && /^[a-f0-9]{64}$/.test(input.review_fingerprint), 'Invalid network lifecycle review')
    request.vnet = input.vnet
    request.action = input.action
  } else if (input.kind === 'host_firewall') {
    requireValue(input.acknowledge_shared_scope === true && /^[a-f0-9]{64}$/.test(input.review_fingerprint), 'Invalid host firewall review')
  } else requireValue(['scenario_firewall', 'runtime_observe'].includes(input.kind), 'Unsupported runtime operation')
  if (!['runtime_observe', 'sdn_network', ...policyKinds].includes(input.kind)) request.enabled = input.enabled
  if (['sdn_snat', 'host_firewall', 'sdn_network', ...policyKinds].includes(input.kind)) request.acknowledge_shared_scope = true
  requireValue(terminal.has(attempt.state) || ['pending', 'deploying', 'running'].includes(attempt.state), 'Unknown runtime attempt state')
  const phase = terminal.has(attempt.state) ? 'result' : 'request'
  const record = { version: phase === 'result' ? 2 : 1, phase, backend_url: scope, deployment_id: deployment.id, attempt_id: attempt.id,
    project_sha: operation.project_sha, target_host_id: operation.target_host_id, request }
  if (phase === 'result') {
    record.state = attempt.state
    const endedAt = utcTimestamp(attempt.ended_at)
    if (endedAt) record.ended_at = endedAt
    if (Number.isInteger(attempt.rc)) record.rc = attempt.rc
    const result = attempt.operation_result
    record.result = result ? { error_present: Boolean(result.error) } : null
    if (result) {
      for (const field of ['desired_reached', 'partial', 'live_forwarding_verified']) {
        if (typeof result[field] === 'boolean') record.result[field] = result[field]
      }
      for (const field of ['matched_vmids', 'missing_vmids', 'mismatched_vmids']) {
        if (Array.isArray(result[field]) && result[field].length <= 4096 && result[field].every(vmid)) record.result[field] = result[field]
      }
    }
  }
  return { path: `scenarios/${deployment.scenario_label}/runtime/${deployment.id}/${attempt.id}/${phase}.json`,
    content: `${JSON.stringify(record, null, 2)}\n`, phase }
}

/** A legacy candidate still needs exact readback at its immutable Git receipt. */
export function isLegacyRuntimeRecord(record, content) {
  if (record.phase !== 'result' || typeof content !== 'string') return false
  try {
    const expected = { ...JSON.parse(record.content), version: 1 }
    const legacy = JSON.parse(content)
    if (expected.ended_at) {
      if (typeof legacy?.ended_at !== 'string' || utcTimestamp(legacy.ended_at) !== legacy.ended_at) return false
      expected.ended_at = legacy.ended_at
    }
    // All other fields, the schema and the original serialization must match.
    return content === `${JSON.stringify(expected, null, 2)}\n`
  } catch { return false }
}

/** Verify historical bytes; never create, replace, or migrate a Git record. */
export async function verifyRuntimeRecordReceipt(project, deployment, attempt, scope) {
  requireValue(registeredLocalProject(deployment.project_id, [project], scope) === project
    && project.scenario?.label === deployment.scenario_label, 'Open the matching registered project to verify this runtime record')
  const binding = { ...project.git }
  const record = buildRuntimeRecord(deployment, attempt, scope)
  const content = project.files?.[record.path]
  const sha = project.runtime_git_receipts?.[JSON.stringify([scope, record.path])]
  requireValue(shaPattern.test(sha), 'A saved Git receipt is required to verify a legacy runtime record')
  requireValue(isLegacyRuntimeRecord(record, content), 'Review the local runtime record before verifying its legacy Git receipt')
  const prefix = binding.subdir ? `${safePath(binding.subdir.replace(/\/+$/, ''))}/` : ''
  const provider = providerForBinding(binding)
  const existing = await provider.getFile({ owner: binding.repo_owner, repo: binding.repo_name, path: `${prefix}${record.path}`, ref: sha })
  requireValue(existing.content === content, 'The saved Git receipt does not match this local runtime record. Review the file before saving.')
  return { ...record, content, commit_sha: sha }
}

/** Append a record and its file index without serializing or overwriting the canvas. */
export async function saveRuntimeRecord(project, deployment, attempt, scope) {
  requireValue(registeredLocalProject(deployment.project_id, [project], scope) === project
    && project.scenario?.label === deployment.scenario_label, 'Open the matching registered project to save this runtime change')
  const binding = { ...project.git }
  const projectId = project.id
  const record = buildRuntimeRecord(deployment, attempt, scope)
  const branch = binding.working_branch || workingBranchForProject(projectId)
  requireValue(branch !== (binding.branch || 'main'), 'Choose a dedicated working branch for runtime records')
  const prefix = binding.subdir ? `${safePath(binding.subdir.replace(/\/+$/, ''))}/` : ''
  const path = `${prefix}${record.path}`
  const metaPath = `${prefix}meta.json`
  const provider = providerForBinding(binding)
  requireValue(provider.commitFiles, 'This Git provider cannot commit a runtime record atomically')
  const repo = { owner: binding.repo_owner, repo: binding.repo_name }
  return runOnBranch(binding, branch, async () => {
    requireValue(await provider.canWrite(repo.owner, repo.repo), 'Write access to the project repository is required')
    const head = (await provider.listCommits({ ...repo, ref: branch, perPage: 1 }))[0]?.sha
    requireValue(shaPattern.test(head), 'Save the project working branch before recording runtime changes')
    const existingMeta = await provider.getFile({ ...repo, path: metaPath, ref: head })
    const meta = JSON.parse(existingMeta.content)
    requireValue(meta && typeof meta === 'object' && !Array.isArray(meta)
      && Array.isArray(meta.ui_files) && meta.ui_files.length < 10000, 'The saved project file index is invalid')
    meta.ui_files.forEach(safePath)
    let existing
    try { existing = await provider.getFile({ ...repo, path, ref: head }) }
    catch (error) {
      // Older provider adapters preserve HTTP status in this exact message form.
      if (error.status !== 404 && !/^(?:GitHub|GitLab|Gitea) GET \S+ -> 404(?:\s|$)/.test(error.message || '')) throw error
    }
    requireValue(!existing || existing.content === record.content, 'A different record already exists for this runtime attempt')
    const saved = { ...record, branch, expected_head: head, commit_sha: head }
    if (existing && meta.ui_files.includes(record.path)) return saved
    const files = []
    if (!meta.ui_files.includes(record.path)) {
      files.push({ path: metaPath, content: JSON.stringify({ ...meta, ui_files: [...meta.ui_files, record.path] }, null, 2), sha: existingMeta.sha })
    }
    if (!existing) files.push({ path, content: record.content })
    const commit = await provider.commitFiles({ ...repo, branch, expectedHead: head, files,
      message: `Record runtime ${record.phase}: ${deployment.id}/${attempt.id}` })
    requireValue(shaPattern.test(commit.sha), 'The Git provider did not return a saved commit revision')
    return { ...saved, commit_sha: commit.sha }
  })
}
