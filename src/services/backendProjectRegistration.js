import { backendRequest, getBackendScope } from './backendApi'

const STORAGE_KEY = 'range42_project_registrations'
const newId = () => `project_${crypto.randomUUID().replace(/-/g, '')}`

function registrations() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

/** Match the backend registration to one current browser repository binding. */
export function registeredLocalProject(backendProjectId, projects, scope = getBackendScope()) {
  if (typeof backendProjectId !== 'string' || !backendProjectId) return null
  const records = registrations()
  const matches = projects.filter(project => {
    const git = project?.git
    if (!git) return false
    const key = JSON.stringify([scope, project.id, git.source_id,
      git.branch_strategy, git.repo_owner, git.repo_name, git.subdir || ''])
    return records[key]?.id === backendProjectId
  })
  return matches.length === 1 ? matches[0] : null
}

export function latestSavedProjectRevision(backendProjectId) {
  try {
    const projects = JSON.parse(localStorage.getItem('range42_projects') || '[]')
    const records = registrations()
    for (const project of projects) {
      const git = project.git
      if (!git) continue
      const key = JSON.stringify([getBackendScope(), project.id, git.source_id,
        git.branch_strategy, git.repo_owner, git.repo_name, git.subdir || ''])
      if (records[key]?.id === backendProjectId && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(project.head_sha || '')) return project.head_sha
    }
  } catch { /* A missing or damaged local cache cannot select a deployment revision. */ }
  return ''
}

/** Register the saved repository in the selected backend, without sending Git credentials. */
export async function ensureBackendProject(project) {
  if (!project?.git) throw new Error('Connect this project to a Git repository before deploying')
  const scope = getBackendScope()
  const binding = project.git
  const body = { name: project.name, source_id: binding.source_id,
    branch_strategy: binding.branch_strategy, repo_owner: binding.repo_owner,
    repo_name: binding.repo_name, subdir: binding.subdir || '' }
  const bindingKey = JSON.stringify([scope, project.id, body.source_id,
    body.branch_strategy, body.repo_owner, body.repo_name, body.subdir])
  const records = registrations()
  const alreadyBound = Object.keys(records).some(key => {
    try { const [backend, id] = JSON.parse(key); return backend === scope && id === project.id } catch { return false }
  })
  let id = records[bindingKey]?.id
    || (!alreadyBound && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(project.id) ? project.id : newId())
  const put = () => backendRequest(`/v1/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) })
  let result
  try {
    result = await put()
  } catch (error) {
    if (scope !== getBackendScope()) throw new Error('The selected backend changed while registering the project; retry on the current backend')
    if (error.code !== 'PROJECT_BINDING_IN_USE') throw error
    id = newId()
    result = await put()
  }
  if (scope !== getBackendScope()) throw new Error('The selected backend changed while registering the project; retry on the current backend')
  if (result.id !== id) throw new Error('Backend returned a different project identity')
  const latest = registrations()
  latest[bindingKey] = { id }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(latest))
  return { ...result, scope }
}
