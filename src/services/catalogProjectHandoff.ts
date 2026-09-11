import { loadCatalogRoleFiles } from '@/services/catalogRoleTree'
import { providerForBinding, buildProjectFiles, buildPushArgs } from '@/composables/useProjectGitSync'
import { validateFileMap } from '@/services/projectFiles'
import type { CatalogEntry } from '@/composables/useCatalog'
import type { GitSource } from '@/stores/inventoryStore'
import type { GitProviderV1 } from '@/services/git/types'
import { workingBranchForProject, type ProjectGitBinding } from '@/composables/useProjectGitSync'
import { validateProjectBinding } from '@/services/gitProjectOpen'
import { publicCatalogReference } from '@/services/catalogReference'
import { captureProjectAuthoring, objectValue } from '@/services/projectAuthoring'
import { deserializeToCanvas, serializeToCatalogEntry } from '@/overlay/serialize'
import { captureCanvasSnapshot, readCanvasSnapshot } from '@/services/projectCanvasSnapshot'
import type { CatalogEntry as CatalogDocument } from '@/types/range42-schema'
import { isGitNotFound } from '@/services/git/fileContent'

const exactSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

/** Require every supplied executable field to survive the existing serializer. */
function retains(original: unknown, restored: unknown, path: string): void {
  if (Array.isArray(original)) {
    if (!Array.isArray(restored) || original.length !== restored.length) throw new Error(`Unsupported catalog field ${path}; its content cannot be preserved`)
    original.forEach((value, index) => retains(value, restored[index], `${path}[${index}]`))
  } else if (original && typeof original === 'object') {
    const target = objectValue(restored, `Unsupported catalog field ${path}`)
    for (const [key, value] of Object.entries(original)) retains(value, target[key], `${path}.${key}`)
  } else if (original !== restored) throw new Error(`Unsupported catalog field ${path}; its content cannot be preserved`)
}

function catalogCanvas(entry: CatalogEntry) {
  const doc = objectValue(entry.document ?? {}, 'Catalog document')
  if (!['lab', 'gamenet', 'component'].includes(entry.kind) || doc.schema_version !== '1.0'
    || !['lab', 'gamenet', 'component'].includes(String(doc.kind)) || typeof doc.name !== 'string'
    || !Array.isArray(doc.nodes) || !doc.nodes.length) {
    throw new Error('This handoff supports range42.yaml lab, gamenet or component items with a nonempty node topology. Use Open from Git for a saved project, or the role/bundle authoring tools for this item.')
  }
  const supported = ['schema_version', 'kind', 'name', 'description', 'author', 'tags', 'nodes', 'env', 'bridge_base', 'naming_prefix']
  for (const key of Object.keys(doc)) if (!supported.includes(key)) throw new Error(`Unsupported catalog field ${key}; open the complete Git project to preserve its behavior`)
  const original = deserializeToCanvas(doc as unknown as CatalogDocument, { nodes: {}, edges: {}, unsupported: [] })
  for (const attachment of original.attachments) {
    const source = objectValue(attachment.source, 'Attachment source')
    if (!['inline_yaml', 'file_upload'].includes(String(source.kind)) || typeof source.content_inline !== 'string'
      || Object.keys(source).some(key => !['kind', 'content_inline'].includes(key))) {
      throw new Error(`Unresolved catalog dependency ${String(source.content_ref || source.ref || source.url || source.kind)}: open a complete Git project with its files, or attach the verified bundle before importing`)
    }
  }
  const canvas = readCanvasSnapshot(captureCanvasSnapshot(original), original.attachments)
  const restored = serializeToCatalogEntry(canvas, { name: doc.name, kind: doc.kind as CatalogDocument['kind'],
    bridge_base: typeof doc.bridge_base === 'number' ? doc.bridge_base : 140 })
  retains(doc.nodes, restored.nodes, 'nodes')
  if (doc.naming_prefix !== undefined && doc.naming_prefix !== restored.naming_prefix) throw new Error('Unsupported catalog naming_prefix; the editor would change its naming scheme')
  return { canvas, doc, variables: captureProjectAuthoring('catalog', { variables: doc.env }).variables }
}

/** No writes: pin destination HEAD and reject collisions before local creation. */
export async function prepareCatalogProject(input: {
  entry: CatalogEntry; source: GitSource; binding: ProjectGitBinding; mode: 'use' | 'customize'; projectId: string
}, provider: GitProviderV1, originProvider?: GitProviderV1) {
  const { entry, source, mode, projectId } = JSON.parse(JSON.stringify(input)) as typeof input
  const binding = { ...input.binding }
  validateProjectBinding(binding)
  if (source.id !== entry.source_id || source.repos.length !== 1) throw new Error('The catalog source must identify exactly one repository')
  if (!exactSha.test(entry.sha || '')) throw new Error('Refresh this catalog item to obtain its exact commit SHA')
  const repo = source.repos[0]
  const catalogRef = publicCatalogReference({ version: 1, kind: entry.kind, mode, source_id: source.id, provider: source.provider,
    base_url: source.base_url, repo_owner: repo.owner, repo_name: repo.repo, branch: repo.branch,
    path: entry.path, sha: entry.sha, ...(source.backend_url !== undefined ? { backend_url: source.backend_url } : {}) })!
  const role = entry.kind === 'ansible_role'
  const { canvas, doc, variables } = role
    ? { canvas: { nodes: [], edges: [], attachments: [] }, doc: { name: entry.name, kind: 'component', bridge_base: 140 }, variables: [] }
    : catalogCanvas(entry)
  const files = role ? await loadCatalogRoleFiles({ owner: repo.owner, repo: repo.repo, path: entry.path, sha: entry.sha! },
    originProvider || providerForBinding({ source_id: source.id, provider: source.provider, base_url: source.base_url })) : {}
  const pendingFork = binding.fork_policy === 'fork' || !await provider.canWrite(binding.repo_owner, binding.repo_name)
  if (pendingFork && (binding.fork_policy === 'upstream' || !provider.ensureFork)) throw new Error('This destination has no write access. Choose a writable repository or enable its supported fork policy.')
  const working_branch = workingBranchForProject(projectId)
  let exists = false
  try { exists = (await provider.listCommits({ owner: binding.repo_owner, repo: binding.repo_name, ref: working_branch, perPage: 1 })).length > 0 }
  catch (error) { if (!isGitNotFound(error)) throw error }
  if (exists) throw new Error('The proposed working branch already exists. Start a new handoff instead of overwriting it.')
  const commits = await provider.listCommits({ owner: binding.repo_owner, repo: binding.repo_name, ref: binding.branch || 'main', perPage: 1 })
  const seed = commits[0]?.sha
  if (!seed || !exactSha.test(seed)) throw new Error('The destination needs an existing base branch with an exact commit SHA')
  const tree = await provider.listTree({ owner: binding.repo_owner, repo: binding.repo_name, ref: seed })
  const prefix = binding.subdir ? `${binding.subdir}/` : ''
  if (tree.some(item => item.path === binding.subdir || (prefix ? item.path.startsWith(prefix) : true))) {
    throw new Error('The destination already contains files at this project path. Choose an unused subdirectory or use Open from Git to edit the existing project.')
  }
  const project = { id: projectId, name: mode === 'customize' ? `${doc.name} (custom)` : String(doc.name),
    ...canvas, files, baseDoc: { env: variables }, gamenet: doc.kind === 'gamenet',
    bridge_base: typeof doc.bridge_base === 'number' ? doc.bridge_base : 140, catalogRef,
    git: { ...binding, working_branch, branch_from: seed }, scenario_generated_paths: [],
  }
  validateFileMap(buildProjectFiles(buildPushArgs(project, project.nodes, project.edges)!))
  return { pendingFork, role, project }
}
export type CatalogProjectPreview = Awaited<ReturnType<typeof prepareCatalogProject>>
