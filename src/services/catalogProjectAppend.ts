import { catalogCanvas } from '@/services/catalogProjectHandoff'
import { publicCatalogImports, publicCatalogReference, type CatalogImportReference } from '@/services/catalogReference'
import { captureProjectAuthoring, inspectProjectAuthoring, objectValue, publicProjectOverlay } from '@/services/projectAuthoring'
import { captureCanvasSnapshot, readCanvasSnapshot } from '@/services/projectCanvasSnapshot'
import { loadCatalogRoleFiles } from '@/services/catalogRoleTree'
import { prepareRoleAttachment } from '@/services/catalogRoleExecution'
import { prepareCatalogWorkload } from '@/services/catalogWorkload'
import { providerForBinding } from '@/composables/useProjectGitSync'
import { createScenarioDraft, emitConcreteScenario } from '@/services/concreteScenario'
import { sanitizeNamingPrefix, type CanvasModel } from '@/overlay/serialize'
import type { CatalogEntry } from '@/composables/useCatalog'
import type { GitSource } from '@/stores/inventoryStore'
import type { GitProviderV1 } from '@/services/git/types'
import type { ProjectFiles } from '@/services/projectFiles'

export interface CatalogAppendProject extends CanvasModel {
  id: string
  name: string
  files?: ProjectFiles
  baseDoc?: Record<string, unknown> & { env?: unknown }
  scenario?: Record<string, unknown>
  scenario_generated_paths?: string[]
  overlay?: Record<string, unknown>
  catalogImports?: unknown
  [key: string]: unknown
}
export interface CatalogAppendInput {
  entry: CatalogEntry
  source: GitSource
  project: CatalogAppendProject
  targetNode?: string
  instanceName?: string
  hostPorts?: number[]
}
export interface CatalogAppendPreview {
  project: CatalogAppendProject
  addedNodeIds: string[]
  counts: { nodes: number; edges: number; attachments: number; roles: number; files: number }
  warnings: string[]
  provenance: CatalogImportReference
  selectedFile?: string
  review?: Awaited<ReturnType<typeof prepareCatalogWorkload>>['summary']
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => `${JSON.stringify(key)}:${stable(row)}`).join(',')}}`
  return JSON.stringify(value)
}

function appendVariables(project: CatalogAppendProject, incoming: Record<string, unknown>[]) {
  const existing = captureProjectAuthoring(project.id, { variables: project.baseDoc?.env }).variables
  const names = new Map(existing.map(row => [row.name, row]))
  const added = incoming.filter(row => {
    const overrides = project.overlay?.param_overrides
    const env = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? (overrides as Record<string, unknown>).env : undefined
    if (env && typeof env === 'object' && Object.hasOwn(env, String(row.name))
      && stable((env as Record<string, unknown>)[String(row.name)]) !== stable(row.default)) throw new Error(`Project variable override ${String(row.name)} conflicts with the catalog default; review it before appending`)
    const previous = names.get(row.name)
    if (previous && stable(previous) !== stable(row)) throw new Error(`Project variable ${String(row.name)} conflicts with the catalog definition; review it before appending`)
    return !previous
  })
  if (added.length) project.baseDoc = { ...project.baseDoc, env: [...copy((project.baseDoc?.env || []) as unknown[]), ...added] }
}

function rejectExecutionIdentity(config: Record<string, unknown>) {
  const forbidden = new Set(['vmid', 'vm_id', 'vmId', 'actualConfig', 'desiredConfig', 'allocation', 'allocation_id', 'allocation_token',
    'deployment_id', 'backend_project_id', 'target_host_id', 'attempt_id', 'claim', 'reservation', 'reservation_token'])
  for (const key of Object.keys(config)) if (forbidden.has(key)) throw new Error(`Catalog execution identity ${key} cannot be appended; keep reusable configuration only`)
  if ('nics' in config || 'network_id' in config || 'primary_nic_key' in config) throw new Error('Use canonical node networks for NIC references; scenario NIC identity cannot be inferred from arbitrary catalog configuration')
}

function regenerateOwnedContent(original: CatalogAppendProject, result: CatalogAppendPreview) {
  if (!original.scenario) return
  const metadata = captureProjectAuthoring(original.id, { scenario: original.scenario, generated_paths: original.scenario_generated_paths, variables: original.baseDoc?.env })
  const inspection = inspectProjectAuthoring({ meta: { name: original.name, ui_project: metadata }, files: original.files,
    overlay: JSON.stringify(publicProjectOverlay(original.overlay, metadata.variables)) }, original)
  if (inspection.status !== 'structured') {
    result.warnings.push('Review Scenario and generate files before saving catalog additions; existing generated files were not changed.')
    return
  }
  const generated = emitConcreteScenario({ ...result.project, scenario: objectValue(result.project.scenario, 'Scenario'), generatedPaths: original.scenario_generated_paths || [] })
  Object.assign(result.project, { files: generated.files, scenario: generated.scenario, scenario_generated_paths: generated.generatedPaths })
}

/** Read-only source reads, then one complete candidate; callers choose when to apply. */
export async function prepareCatalogAppend(input: CatalogAppendInput, provider?: GitProviderV1): Promise<CatalogAppendPreview> {
  const { entry, source, targetNode, instanceName, hostPorts } = copy(input)
  const original = copy(input.project)
  const project = copy(original)
  if (source.id !== entry.source_id || source.repos.length !== 1) throw new Error('The catalog source must identify exactly one repository')
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(entry.sha || '')) throw new Error('Refresh the catalog item to obtain an exact commit SHA')
  const repo = source.repos[0]
  const origin = publicCatalogReference({ version: 1, mode: 'use', kind: entry.kind, source_id: source.id, provider: source.provider,
    base_url: source.base_url, repo_owner: repo.owner, repo_name: repo.repo, branch: repo.branch, path: entry.path, sha: entry.sha,
    ...(source.backend_url !== undefined ? { backend_url: source.backend_url } : {}) })!
  project.nodes ??= []; project.edges ??= []; project.attachments ??= []
  readCanvasSnapshot(captureCanvasSnapshot(project), project.attachments)
  const imports = publicCatalogImports(project.catalogImports)
  const used = new Set([...project.nodes.map(row => row.id), ...project.edges.map(row => row.id),
    ...project.attachments.map(row => row.id), ...imports.map(row => row.id),
    ...(Array.isArray(project.scenario?.content) ? project.scenario.content.map(row => objectValue(row, 'Content').id) : [])])
  const prefix = instanceName || 'catalog'
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,47}$/.test(prefix)) throw new Error('Choose an ASCII instance name starting with a letter')
  let sequence = 1
  while ([...used].some(value => typeof value === 'string' && (value === `${prefix}-${sequence}` || value.startsWith(`${prefix}-${sequence}-`)))) sequence++
  const id = `${prefix}-${sequence}`
  const provenance: CatalogImportReference = { version: 1, id, origin, node_ids: [], attachment_ids: [], content_ids: [] }
  const result: CatalogAppendPreview = { project, addedNodeIds: provenance.node_ids, counts: { nodes: 0, edges: 0, attachments: 0, roles: 0, files: 0 },
    warnings: [], provenance }
  if (entry.kind === 'ansible_role') {
    if (!targetNode || !project.nodes.some(node => node.id === targetNode && node.type === 'vm')) throw new Error('Choose an existing target VM before appending a role')
    const files = await loadCatalogRoleFiles({ owner: repo.owner, repo: repo.repo, path: entry.path, sha: entry.sha! },
      provider || providerForBinding({ source_id: source.id, provider: source.provider, base_url: source.base_url }))
    const attachment = prepareRoleAttachment({ sourceProject: { catalogRef: origin, files }, targetFiles: project.files || {}, targetNode, id })
    const scenario = project.scenario || createScenarioDraft(project, project.nodes, project.edges)
    const content = scenario.content ?? []
    if (!Array.isArray(content)) throw new Error('Scenario content must be a list before appending')
    result.counts.roles = 1
    result.counts.files = Object.keys(attachment.files).filter(path => !Object.hasOwn(project.files || {}, path)).length
    project.files = attachment.files
    project.scenario = { ...scenario, content: [...content, attachment.item] }
    provenance.content_ids.push(id)
    result.selectedFile = `${entry.path}/tasks/${Object.hasOwn(files, `${entry.path}/tasks/main.yml`) ? 'main.yml' : 'main.yaml'}`
    result.warnings.push('Review the selected VM and role variables before saving or executing this content.')
    regenerateOwnedContent(original, result)
    result.counts.files = Object.keys(project.files || {}).filter(path => !Object.hasOwn(original.files || {}, path)).length
  } else if (entry.kind === 'container') {
    if (!targetNode || !project.nodes.some(node => node.id === targetNode && node.type === 'vm')) throw new Error('Choose an existing target VM before appending a workload')
    const workload = await prepareCatalogWorkload({ entry, source, project, scenario: project.scenario || createScenarioDraft(project, project.nodes, project.edges),
      targetNode, attachmentId: id, hostPorts }, provider || providerForBinding({ source_id: source.id, provider: source.provider, base_url: source.base_url }))
    project.files = workload.files
    project.scenario = workload.scenario
    provenance.content_ids.push(...workload.summary.addedContentIds)
    result.selectedFile = workload.summary.selected_file
    result.review = workload.summary
    result.warnings.push(...workload.summary.prerequisites, ...workload.summary.limitations)
    regenerateOwnedContent(original, result)
    result.counts.files = Object.keys(project.files || {}).filter(path => !Object.hasOwn(original.files || {}, path)).length
  } else {
    const { canvas, variables } = catalogCanvas(entry)
    appendVariables(project, variables)
    const ids = new Map(canvas.nodes.map((node, index) => [node.id, `${id}-node-${index + 1}`]))
    const reference = (value: unknown) => {
      if (typeof value !== 'string' || !ids.has(value)) throw new Error(`Catalog node reference is missing from this item: ${String(value)}`)
      return ids.get(value)!
    }
    const names = new Set(project.nodes.flatMap(node => [node.data?.label, node.data?.config?.name, node.data?.config?.hostname, node.id])
      .filter((name): name is string => typeof name === 'string').map(name => name.toLowerCase()))
    const uniqueName = (value: string) => {
      const base = sanitizeNamingPrefix(value)
      let name = base; let suffix = 2
      while (names.has(name.toLowerCase())) {
        const ending = `-${suffix++}`
        name = `${base.slice(0, 32 - ending.length).replace(/-+$/, '')}${ending}`
      }
      names.add(name.toLowerCase()); return name
    }
    const offset = Math.max(0, ...project.nodes.map(node => Number(node.position?.x) || 0)) + 300
    for (const [index, node] of canvas.nodes.entries()) {
      const oldId = node.id
      const config = node.data?.config || {}
      rejectExecutionIdentity(config)
      node.id = reference(oldId)
      if (node.parentNode) node.parentNode = reference(node.parentNode)
      if (node.parent) node.parent = reference(node.parent)
      node.data ??= {}
      if (node.data.host_ref !== undefined) node.data.host_ref = reference(node.data.host_ref)
      const name = uniqueName(String(config.name || config.hostname || node.data.label || oldId))
      node.data.label = name
      if (node.type === 'vm') node.data.config = { ...config, name }
      if (node.type === 'lxc' && config.hostname) node.data.config = { ...config, hostname: name }
      node.position = node.parentNode ? { x: 40 + (index % 2) * 220, y: 80 + Math.floor(index / 2) * 160 }
        : { x: offset, y: index * 200 }
    }
    for (const [index, edge] of canvas.edges.entries()) {
      edge.id = `${id}-edge-${index + 1}`; edge.source = reference(edge.source); edge.target = reference(edge.target)
    }
    for (const [index, attachment] of canvas.attachments.entries()) {
      attachment.id = `${id}-attachment-${index + 1}`
      attachment.target_node = reference(attachment.target_node)
      if (attachment.node_id !== undefined) attachment.node_id = reference(attachment.node_id)
      if (attachment.inherited_from !== undefined) attachment.inherited_from = reference(attachment.inherited_from)
    }
    project.nodes.push(...canvas.nodes); project.edges.push(...canvas.edges); project.attachments.push(...canvas.attachments)
    readCanvasSnapshot(captureCanvasSnapshot(project), project.attachments)
    provenance.node_ids.push(...canvas.nodes.map(node => node.id))
    provenance.attachment_ids.push(...canvas.attachments.map(row => row.id!))
    Object.assign(result.counts, { nodes: canvas.nodes.length, edges: canvas.edges.length, attachments: canvas.attachments.length })
    result.warnings.push('Review network addresses, SDN names and fresh VM/IP allocation for the changed graph before deployment.')
    if (canvas.nodes.some(node => !['vm', 'group', 'network-segment'].includes(node.type || ''))) result.warnings.push('Some added node types are authoring-only; the current concrete deployment compiler does not support them.')
  }
  project.catalogImports = publicCatalogImports([...imports, provenance])
  return result
}
