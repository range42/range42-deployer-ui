import { sha256 } from '@noble/hashes/sha2.js'
import { parseDocument } from 'yaml'
import { publicCatalogReference } from '@/services/catalogReference'
import { validateCatalogRoleFiles } from '@/services/catalogRoleTree'
import { cloneFiles, fileBytes, fileContentEquals, fileText, validateFileMap, validateFilePath, type ProjectFiles } from '@/services/projectFiles'

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

export interface RoleExecutionSource {
  version: 1
  origin: Record<string, string | number>
  file_hashes: Record<string, string>
}
export interface RoleContentItem {
  id: string
  kind: 'role'
  target_node: string
  path: string
  vars: Record<string, unknown>
  role: RoleExecutionSource
}

function targetSafe(value: unknown, path: string, depth = 0): void {
  if (depth > 32) throw new Error(`Role configuration is too deeply nested: ${path}`)
  if (typeof value === 'string' && /\b(?:lookup|query|q)\s*\(/.test(value)) throw new Error(`Role controller lookup requires explicit dependency review: ${path}`)
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:ansible_|r42_|proxmox_|global_vm_|global_template_|deployer_cli_)/i.test(key)
      || ['delegate_to', 'delegate_facts', 'connection', 'remote_user', 'local_action', 'add_host', 'group_by', 'inventory_hostname', 'hostvars', 'groups', 'playbook_dir', 'role_path'].includes(key.replace(/^ansible\.(?:builtin|legacy)\./, ''))) {
      throw new Error(`Role overrides a managed target or connection: ${key} in ${path}`)
    }
    targetSafe(child, path, depth + 1)
  }
}
function roleFiles(path: string, files: ProjectFiles): ProjectFiles {
  validateFilePath(path)
  const result = cloneFiles(Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith(`${path}/`))))
  if (Object.keys(result).length > 512) throw new Error('The role exceeds the 512-file limit')
  validateCatalogRoleFiles(path, result)
  for (const [name, content] of Object.entries(result)) {
    const relative = name.slice(path.length + 1)
    if (relative.startsWith('templates/')) targetSafe(fileText(content), name)
    if (!/^(?:tasks|handlers|vars|defaults|meta)\/.+\.ya?ml$/.test(relative)) continue
    const doc = parseDocument(fileText(content))
    if (doc.errors.length) throw new Error(`Invalid role YAML: ${name}`)
    targetSafe(doc.toJS({ maxAliasCount: 50 }), name)
  }
  return result
}
function hashes(path: string, files: ProjectFiles): Record<string, string> {
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, content]) => [name.slice(path.length + 1),
    Array.from(sha256(fileBytes(content)), byte => byte.toString(16).padStart(2, '0')).join('')]))
}
export function publicRoleSource(value: unknown): RoleExecutionSource {
  const source = objectValue(value, 'Role source')
  const origin = publicCatalogReference(source.origin)
  if (source.version !== 1 || origin?.version !== 1 || origin.kind !== 'ansible_role') throw new Error('Choose an imported role with exact catalog provenance')
  const input = objectValue(source.file_hashes, 'Role file hashes')
  const entries = Object.entries(input)
  if (!entries.length || entries.length > 512) throw new Error('Role source requires 1–512 reviewed file hashes')
  const file_hashes = Object.fromEntries(entries.map(([path, hash]) => {
    validateFilePath(path)
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid role file hash: ${path}`)
    return [path, hash]
  }))
  return { version: 1, origin, file_hashes }
}

/** Hashes describe authored bytes; they do not assert equality with the original catalog commit. */
export function validateRoleAttachment(item: { path: string; role?: unknown }, files: ProjectFiles) {
  const role = publicRoleSource(item.role)
  if (item.path !== role.origin.path) throw new Error('The attached role path must preserve its catalog naming')
  const current = hashes(item.path, roleFiles(item.path, files))
  if (Object.keys(current).length !== Object.keys(role.file_hashes).length
    || Object.entries(current).some(([path, hash]) => role.file_hashes[path] !== hash)) throw new Error('Role files changed since review. Reattach the current role files before saving this scenario.')
  return { path: item.path, role }
}

/** Pure staged copy: apply only with the complete reviewed scenario update. */
export function prepareRoleAttachment(input: {
  sourceProject: { catalogRef?: unknown; files?: ProjectFiles }; targetFiles: ProjectFiles; targetNode: string; id: string
}): { files: ProjectFiles; item: RoleContentItem } {
  const origin = publicCatalogReference(input.sourceProject.catalogRef)
  if (origin?.version !== 1 || origin.kind !== 'ansible_role' || !input.targetNode || !input.id) throw new Error('Choose an imported catalog role and a target VM')
  const path = String(origin.path)
  const copied = roleFiles(path, input.sourceProject.files || {})
  const files = cloneFiles(input.targetFiles)
  for (const [name, content] of Object.entries(copied)) {
    if (Object.hasOwn(files, name) && !fileContentEquals(files[name], content)) throw new Error(`Role file already exists with different content: ${name}`)
    files[name] = content
  }
  validateFileMap(files)
  return { files, item: { id: input.id, kind: 'role', target_node: input.targetNode, path, vars: {},
    role: { version: 1, origin, file_hashes: hashes(path, copied) } } }
}
