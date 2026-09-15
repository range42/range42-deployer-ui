import { providerForBinding, runOnBranch, workingBranchForProject } from '@/composables/useProjectGitSync'
import { registeredLocalProject } from './backendProjectRegistration'

const terminal = new Set(['succeeded', 'completed', 'partial', 'failed', 'cancelled', 'unknown'])
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
const vmid = value => Number.isInteger(value) && value >= 100 && value <= 999999999

function requireValue(condition, message) { if (!condition) throw new Error(message) }
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
  requireValue(typeof input?.enabled === 'boolean', 'The runtime request must contain an explicit desired state')
  const request = { kind: input.kind }
  if (input.kind === 'vm_firewall') {
    requireValue(vmid(input.vm_id), 'Invalid runtime VM identifier')
    request.vm_id = input.vm_id
  } else if (input.kind === 'sdn_snat') {
    requireValue(/^[a-z][a-z0-9]{0,7}$/.test(input.vnet) && input.acknowledge_shared_scope === true, 'Invalid shared SDN request')
    request.vnet = input.vnet
  } else requireValue(input.kind === 'scenario_firewall', 'Unsupported runtime operation')
  request.enabled = input.enabled
  if (input.kind === 'sdn_snat') request.acknowledge_shared_scope = true
  requireValue(terminal.has(attempt.state) || ['pending', 'deploying', 'running'].includes(attempt.state), 'Unknown runtime attempt state')
  const phase = terminal.has(attempt.state) ? 'result' : 'request'
  const record = { version: 1, phase, backend_url: scope, deployment_id: deployment.id, attempt_id: attempt.id,
    project_sha: operation.project_sha, target_host_id: operation.target_host_id, request }
  if (phase === 'result') {
    record.state = attempt.state
    if (attempt.ended_at && Number.isFinite(Date.parse(attempt.ended_at))) record.ended_at = new Date(attempt.ended_at).toISOString()
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
