import type { CanvasModel } from '@/overlay/serialize'
import type { ProjectState } from '@/services/projectRepo'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { fileContentEquals, validateAuthoredFilePath } from '@/services/projectFiles'

type ObjectValue = Record<string, unknown>
export interface AuthoringInput {
  scenario?: unknown
  generated_paths?: unknown
  variables?: unknown
}
export interface AuthoringMetadata {
  version: 1
  project_id: string
  generated_paths: string[]
  scenario?: ObjectValue
  variables: ObjectValue[]
}
export interface AuthoringInspection {
  status: 'structured' | 'files' | 'legacy' | 'conflict'
  project_id?: string
  scenario?: ObjectValue
  generated_paths: string[]
  variables: ObjectValue[]
  issue?: string
}

export function objectValue(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as ObjectValue
}
function copy(value: unknown): unknown { return JSON.parse(JSON.stringify(value)) }
function fields(value: unknown, keys: string[], label: string): ObjectValue {
  const source = objectValue(value, label)
  // Keep public object order as well as values: sealed bundle resolutions are
  // embedded verbatim in generated JSON, so reordering would create false drift.
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => keys.includes(key) && value !== undefined).map(([key, value]) => [key, copy(value)]))
}
function rows(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`)
  return value
}
function scenarioSnapshot(value: unknown): ObjectValue {
  const source = objectValue(value, 'Scenario')
  const result = fields(source, ['label', 'network_mode', 'zone'], 'Scenario')
  result.networks = rows(source.networks, 'Scenario networks').map(row => fields(row, ['id', 'vnet', 'subnet', 'gateway', 'snat'], 'Network'))
  result.vms = rows(source.vms, 'Scenario VMs').map(row => {
    const vm = fields(row, ['node_id', 'vm_id', 'vm_name', 'template_vm_id', 'network_id', 'ip', 'ssh_user', 'cores', 'memory_mb', 'disk_gb', 'disk_device'], 'VM')
    const sourceVm = objectValue(row, 'VM')
    if (sourceVm.nics !== undefined) vm.nics = rows(sourceVm.nics, 'VM NICs').map(nic => fields(nic, ['network_id', 'ip'], 'NIC'))
    return vm
  })
  result.content = rows(source.content ?? [], 'Scenario content').map(row => {
    const item = fields(row, ['id', 'kind', 'target_node', 'path', 'destination', 'mode', 'vars'], 'Content item')
    const sourceItem = objectValue(row, 'Content item')
    if (sourceItem.resolution !== undefined) {
      // Public, backend-sealed provenance must remain byte-for-byte equivalent;
      // it contains no runtime credentials or allocator ownership secret.
      item.resolution = fields(sourceItem.resolution,
        ['source_id', 'source_sha', 'path', 'entrypoint', 'bundle_kind', 'target_kind', 'params', 'target_vars', 'runtime', 'proof_kind'], 'Bundle resolution')
    }
    return item
  })
  return result
}
function variablesSnapshot(value: unknown): ObjectValue[] {
  const names = new Set<string>()
  return rows(value ?? [], 'Project variables').map(row => {
    const variable = fields(row, ['name', 'scope', 'secret', 'required', 'default', 'description'], 'Variable')
    if (typeof variable.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name) || names.has(variable.name)) throw new Error('Project variables need unique valid names')
    names.add(variable.name)
    if (variable.secret) delete variable.default
    return variable
  })
}

/** Explicit metadata whitelist: no repository PATs, backend credentials or lease ownership. */
export function captureProjectAuthoring(projectId: string, input: AuthoringInput = {}): AuthoringMetadata {
  const paths = rows(input.generated_paths ?? [], 'Generated paths')
  const generated_paths = paths.map(path => {
    if (typeof path !== 'string') throw new Error('Generated paths must be strings')
    validateAuthoredFilePath(path)
    return path
  })
  if (new Set(generated_paths).size !== generated_paths.length) throw new Error('Duplicate generated path ownership')
  if (!input.scenario && generated_paths.length) throw new Error('Generated path ownership requires structured scenario configuration')
  return { version: 1, project_id: projectId, generated_paths, variables: variablesSnapshot(input.variables),
    ...(input.scenario ? { scenario: scenarioSnapshot(input.scenario) } : {}) }
}

export function publicProjectOverlay(overlay: unknown, variables: ObjectValue[]): ObjectValue {
  const result = objectValue(copy(overlay ?? {}), 'Project overlay')
  if (result.param_overrides !== undefined) {
    const overrides = objectValue(result.param_overrides, 'Project overrides')
    if (overrides.env !== undefined) {
      const env = objectValue(overrides.env, 'Project variable overrides')
      for (const variable of variables) if (variable.secret && typeof variable.name === 'string') delete env[variable.name]
    }
  }
  return result
}

/** Recompute ownership before enabling forms; never trust imported deletion paths. */
export function inspectProjectAuthoring(state: ProjectState, canvas: CanvasModel): AuthoringInspection {
  if (state.meta.ui_project === undefined) return { status: 'legacy', generated_paths: [], variables: [] }
  const input = objectValue(state.meta.ui_project, 'Authoring metadata')
  // Secret classifications must survive a scenario/ownership conflict. Invalid
  // declarations block import because their values cannot be safely restored.
  const variables = variablesSnapshot(input.variables)
  let project_id: string | undefined
  try {
    if (typeof input.project_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(input.project_id)) project_id = input.project_id
    if (input.version !== 1) throw new Error('Unsupported authoring metadata version')
    const metadata = captureProjectAuthoring(project_id || '', input)
    if (!metadata.scenario) return { status: 'files', project_id, variables, generated_paths: [] }
    const files = state.files || {}
    for (const path of metadata.generated_paths) if (!Object.hasOwn(files, path)) throw new Error(`Generated file is missing: ${path}`)
    const generated = emitConcreteScenario({ scenario: metadata.scenario, ...canvas, files,
      generatedPaths: [], baseDoc: { env: variables }, overlay: publicProjectOverlay(JSON.parse(state.overlay || '{}'), variables) })
    if (JSON.stringify([...metadata.generated_paths].sort()) !== JSON.stringify([...generated.generatedPaths].sort())) {
      throw new Error('Saved generated-path ownership does not match the scenario compiler')
    }
    for (const path of generated.generatedPaths) if (!fileContentEquals(files[path], generated.files[path])) throw new Error(`Generated file was edited: ${path}`)
    return { status: 'structured', project_id, scenario: metadata.scenario, variables, generated_paths: metadata.generated_paths }
  } catch (error) {
    return { status: 'conflict', project_id, variables, generated_paths: [], issue: error instanceof Error ? error.message : String(error) }
  }
}
