import { parse, stringify } from 'yaml'
import { contentFromBase64, fileBytes, fileContentEquals, validateFileMap, MAX_FILE_BYTES } from './projectFiles'

const copy = value => JSON.parse(JSON.stringify(value))
function requireValue(condition, message) { if (!condition) throw new Error(message) }

/** Only inputs that determine the reviewed executable plan; never persisted. */
export function scenarioReviewSource(project, nodes, edges) {
  return JSON.stringify({ id: project.id, attachments: project.attachments || [], files: project.files || {},
    scenario: project.scenario, generatedPaths: project.scenario_generated_paths || [],
    baseDoc: project.baseDoc, overlay: project.overlay, nodes, edges })
}

/** The store persists this entire update before changing any reactive state. */
export function reviewedScenarioUpdates(project, result, nodes, edges) {
  requireValue(result.reviewSource === scenarioReviewSource(project, nodes, edges), 'Project changed since review. Reopen scenario configuration and review the current content.')
  return { scenario: result.scenario, files: result.files, scenario_generated_paths: result.generatedPaths,
    ...(result.attachments ? { attachments: result.attachments } : {}) }
}

function sourceContent(source, files) {
  let inline
  if (source.content_inline !== undefined) {
    requireValue(typeof source.content_inline === 'string', 'Attachment content must be text or base64')
    if (source.kind === 'file_upload') {
      const value = source.content_inline
      requireValue(value.length <= Math.ceil(MAX_FILE_BYTES / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'Invalid or oversized base64 attachment')
      fileBytes({ encoding: 'base64', content: value, size: atob(value).length })
      inline = contentFromBase64(value)
    } else inline = source.content_inline
  }
  const reference = source.content_ref
  if (reference !== undefined) {
    requireValue(typeof reference === 'string' && Object.hasOwn(files, reference), 'Referenced attachment file is missing; load its pinned bytes into the project first')
    requireValue(inline === undefined || fileContentEquals(inline, files[reference]), 'Inline and referenced attachment files contain different bytes; resolve the conflict first')
  }
  const value = inline ?? (reference === undefined ? undefined : files[reference])
  requireValue(value !== undefined, 'Attachment content is missing; load its pinned file before migration')
  return value
}

// Moving content with relative dependencies, shared handlers or delegated work
// requires an explicit mapping; guessing would change its execution semantics.
function checkSelfContained(value) {
  if (typeof value === 'string') {
    requireValue(!/\b(?:lookup|query|q)\s*\(/.test(value), 'Content lookups require dependency mapping before migration')
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const action = key.replace(/^ansible\.(?:builtin|legacy)\./, '')
    requireValue(!/^(?:ansible_|global_vm_|r42_|proxmox_)/i.test(key), 'Reserved connection or managed target variables need explicit review outside attachment migration')
    requireValue(!['notify', 'listen', 'handlers', 'handler_namespace'].includes(action), 'Handler/notify semantics need an explicit playbook mapping')
    requireValue(!['delegate_to', 'delegate_facts', 'local_action', 'run_once', 'connection'].includes(action), 'Delegation or target overrides need explicit review outside attachment migration')
    requireValue(!action.startsWith('with_') && !['include', 'include_tasks', 'import_tasks', 'include_vars', 'include_role', 'import_role', 'import_playbook', 'roles', 'vars_files', 'template', 'script', 'action'].includes(action), 'Relative or lookup dependencies need an explicit file/bundle mapping')
    if (action === 'copy') requireValue(child && typeof child === 'object' && (!child.src || child.remote_src === true), 'Local copy sources need an explicit dependency mapping')
    checkSelfContained(child)
  }
}

export function inspectAttachment(attachment, nodes, files) {
  const a = attachment
  requireValue(a && typeof a.id === 'string' && a.id, 'Legacy attachment needs a stable identifier')
  requireValue(nodes.some(node => node.id === a.target_node && node.type === 'vm'), `Select an existing target VM for attachment ${a.id}`)
  requireValue(!a.scope || a.scope === 'node', 'Group inheritance needs an explicit target mapping')
  requireValue((a.stage || 'main') === 'main', 'Only the main stage can migrate after VM bootstrap; map custom stages explicitly')
  requireValue(a.order_in_stage === undefined || (Number.isInteger(a.order_in_stage) && a.order_in_stage >= 0), 'Attachment order must be a non-negative integer')
  requireValue(!a.handler_namespace && (!a.ansible_primitive || ['task', 'block'].includes(a.ansible_primitive)), 'Handler semantics need an explicit playbook mapping')
  requireValue(Object.keys(a).every(key => ['id', 'target_node', 'source', 'title', 'stage', 'order_in_stage', 'scope', 'vars', 'ansible_primitive', 'handler_namespace'].includes(key)), 'Unknown attachment options need explicit mapping')
  checkSelfContained(a.vars)
  const source = a.source || {}
  requireValue(!['catalog_role', 'catalog_container'].includes(source.kind), 'Select the matching verified item from the bundle library; catalog roles/containers cannot be assumed equivalent')
  requireValue(['inline_yaml', 'file_upload'].includes(source.kind), 'Load pinned Git files and review their target/dependencies before replacing this attachment')
  requireValue(Object.keys(source).every(key => ['kind', 'content_inline', 'content_ref'].includes(key)), 'Attachment source references need explicit dependency mapping')
  const content = sourceContent(source, files)
  if (source.kind === 'file_upload') return { content, kind: '' }
  const text = typeof content === 'string' ? content : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fileBytes(content))
  const yaml = parse(text.replace(/^\uFEFF/, ''))
  requireValue(Array.isArray(yaml) && yaml.length > 0 && yaml.every(row => row && typeof row === 'object' && !Array.isArray(row)), 'Inline YAML must be a non-empty list of tasks, blocks or plays')
  checkSelfContained(yaml)
  return { content: text, kind: yaml.every(row => typeof row.hosts === 'string') ? 'playbook' : 'tasks' }
}

/** Pure candidate: no project mutation, file deletion or provider writes. */
export function prepareAttachmentMigration({ project, scenario, nodes, choices = {} }) {
  const files = { ...(project.files || {}) }
  validateFileMap(files)
  const draft = copy(scenario)
  const attachments = project.attachments || []
  checkSelfContained(project.baseDoc?.env)
  checkSelfContained(project.overlay?.param_overrides?.env)
  requireValue(new Set(attachments.map(a => a.id)).size === attachments.length, 'Duplicate legacy attachment identifiers need repair before migration')
  const inspected = attachments.map(a => ({ attachment: a, ...inspectAttachment(a, nodes, files) }))
    .sort((a, b) => (a.attachment.order_in_stage ?? 0) - (b.attachment.order_in_stage ?? 0))
  const rows = []
  const base = `scenarios/${draft.label}`
  const write = (path, value) => {
    requireValue(!Object.hasOwn(files, path) || fileContentEquals(files[path], value), `Migration path already exists: ${path}; preserve or relocate the existing file first`)
    files[path] = value
  }
  for (const [index, inspectedItem] of inspected.entries()) {
    const { attachment: a } = inspectedItem
    const choice = Object.hasOwn(choices, a.id) ? choices[a.id] : {}
    const kind = inspectedItem.kind || choice.kind
    requireValue(['file', 'script', 'tasks', 'playbook'].includes(kind), `Choose a content kind for uploaded attachment ${a.id}`)
    const id = `legacy-${index + 1}`
    requireValue(!draft.content.some(item => item.id === id), 'Migration content identifier already exists; resolve the previous conversion first')
    let content = inspectedItem.content
    if (kind !== 'file' && typeof content !== 'string') content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fileBytes(content))
    if (kind !== 'file') requireValue(!content.includes('\0'), 'Executable content must be UTF-8 text without NUL bytes')
    if (['tasks', 'playbook'].includes(kind)) {
      const parsed = parse(content.replace(/^\uFEFF/, ''))
      requireValue(Array.isArray(parsed) && parsed.length > 0 && parsed.every(row => row && typeof row === 'object' && !Array.isArray(row)), 'Ansible content must contain a non-empty list')
      checkSelfContained(parsed)
      if (kind === 'tasks') requireValue(parsed.every(row => !Object.hasOwn(row, 'hosts')), 'Choose playbook for YAML containing hosts')
    }
    const path = `content/${id}.${kind === 'file' ? 'bin' : kind === 'script' ? 'sh' : 'yml'}`
    if (kind === 'tasks') {
      write(`${base}/content/${id}.tasks.yml`, content)
      content = stringify([{ hosts: '{{ global_vm_ssh_name }}', gather_facts: false, become: true,
        tasks: [{ 'ansible.builtin.import_tasks': `${id}.tasks.yml` }] }])
    }
    write(`${base}/${path}`, content)
    const item = { id, kind: kind === 'tasks' ? 'playbook' : kind, target_node: a.target_node, path, vars: copy(a.vars || {}) }
    if (kind === 'file') {
      requireValue(typeof choice.destination === 'string' && choice.destination.startsWith('/'), `Choose an absolute guest destination for attachment ${a.id}`)
      item.destination = choice.destination
      item.mode = choice.mode || '0644'
    }
    draft.content.push(item)
    rows.push({ id: a.id, target_node: a.target_node, kind, path, order: a.order_in_stage ?? 0 })
  }
  if (attachments.length) write(`${base}/content/legacy-attachments.json`, `${JSON.stringify({ version: 1, attachments }, null, 2)}\n`)
  validateFileMap(files)
  return { scenario: draft, files, attachments: [], rows }
}
