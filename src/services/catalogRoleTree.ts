import { parseDocument } from 'yaml'
import { readFileContent } from '@/services/git/fileContent'
import type { GitProviderV1 } from '@/services/git/types'
import { fileText, validateFileMap, validateFilePath, type ProjectFiles } from '@/services/projectFiles'

function yaml(content: string, path: string): unknown {
  const document = parseDocument(content)
  if (document.errors.length) throw new Error(`${path}: ${document.errors[0].message}`)
  return document.toJS({ maxAliasCount: 50 })
}
function mapping(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function resolveLocal(directory: string, reference: unknown, files: ProjectFiles, root: string): void {
  if (typeof reference !== 'string' || !reference || reference.startsWith('/') || reference.includes('\\') || /[{}]/.test(reference)) throw new Error(`Unresolved role file dependency ${String(reference)}`)
  const parts = directory.split('/')
  for (const part of reference.split('/')) {
    if (part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const resolved = parts.join('/')
  if (!resolved.startsWith(`${root}/`) || !Object.hasOwn(files, resolved) && !Object.keys(files).some(path => path.startsWith(`${resolved}/`))) throw new Error(`Unresolved role file dependency ${reference}`)
}
function checkLookups(value: unknown, path: string, depth = 0): void {
  if (depth > 32) throw new Error(`Role YAML nesting exceeds the supported bound: ${path}`)
  if (typeof value === 'string' && /\b(?:lookup|query)\s*\(/.test(value)) throw new Error(`Unresolved controller lookup dependency in ${path}`)
  if (value && typeof value === 'object') for (const nested of Object.values(value)) checkLookups(nested, path, depth + 1)
}
function checkTasks(value: unknown, file: string, files: ProjectFiles, root: string): void {
  if (Array.isArray(value)) { value.forEach(item => checkTasks(item, file, files, root)); return }
  if (!mapping(value)) return
  for (const [key, input] of Object.entries(value)) {
    if (['action', 'local_action'].includes(key)) throw new Error(`Unsupported alternate role action ${key} in ${file}; use an explicit module mapping before import`)
    if (['with_file', 'with_fileglob', 'with_first_found', 'with_lines'].includes(key)) throw new Error(`Unresolved implicit controller lookup ${key} in ${file}`)
    const action = key.split('.').at(-1)
    if (action === 'import_role' || action === 'include_role') throw new Error(`Unresolved role dependency ${mapping(input) ? input.name : input}`)
    if (action === 'import_tasks' || action === 'include_tasks') resolveLocal(file.slice(0, file.lastIndexOf('/')), mapping(input) ? input.file : input, files, root)
    if (action === 'include_vars') resolveLocal(`${root}/vars`, mapping(input) ? input.file || input.dir : input, files, root)
    if (['copy', 'template', 'script', 'unarchive'].includes(action || '')) {
      if (!mapping(input)) throw new Error(`Unresolved role ${action} file declaration in ${file}; use an explicit src mapping`)
      if (action === 'script' && typeof input.cmd === 'string') resolveLocal(`${root}/files`, input.cmd.split(/\s+/)[0], files, root)
      if (input.src !== undefined && input.remote_src !== true) resolveLocal(`${root}/${action === 'template' ? 'templates' : 'files'}`, input.src, files, root)
    }
    if (['block', 'rescue', 'always'].includes(key)) checkTasks(input, file, files, root)
  }
}

function validateRoleName(root: string): void {
  const name = root.split('/').at(-1) || ''
  if (!/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/.test(name) || name.length > 128) throw new Error('The role must preserve the catalog category.action.target naming scheme')
}

/** Preserve a complete, bounded regular-file role tree; never dereference symlinks. */
export async function loadCatalogRoleFiles(input: { owner: string; repo: string; path: string; sha: string },
  provider: Pick<GitProviderV1, 'listTree' | 'getFile' | 'getFileContent'>): Promise<ProjectFiles> {
  const { owner, repo, path: root, sha } = input
  validateFilePath(root)
  validateRoleName(root)
  const tree = await provider.listTree({ owner, repo, path: root, ref: sha })
  const files: ProjectFiles = {}
  if (tree.length > 512) throw new Error('The role exceeds the 512-entry import limit; choose a smaller self-contained role')
  for (const item of tree) {
    if (item.path !== root && !item.path.startsWith(`${root}/`)) throw new Error(`Repository returned a path outside the selected role: ${item.path}`)
    validateFilePath(item.path)
    if (item.type === 'tree') continue
    if (item.mode !== '100644') throw new Error(`Unsupported file mode ${item.mode || 'unknown'} for ${item.path}; executable files, symlinks and submodules require a full repository workflow`)
    if (Object.hasOwn(files, item.path)) throw new Error(`Duplicate role path: ${item.path}`)
    const file = await readFileContent(provider, { owner, repo, path: item.path, ref: sha })
    if (file.sha !== item.sha) throw new Error(`Pinned role file changed or resolved through a symlink: ${item.path}`)
    files[item.path] = file.content
    validateFileMap(files)
  }
  validateCatalogRoleFiles(root, files)
  return files
}

/** Revalidate already materialized project files after local edits. */
export function validateCatalogRoleFiles(root: string, files: ProjectFiles): void {
  validateFilePath(root)
  validateRoleName(root)
  validateFileMap(files)
  if (!['main.yml', 'main.yaml'].some(name => Object.hasOwn(files, `${root}/tasks/${name}`))) throw new Error('The selected role has no tasks/main.yml or tasks/main.yaml')
  for (const [path, content] of Object.entries(files)) {
    if (!/\.ya?ml$/.test(path)) continue
    const parsed = yaml(fileText(content), path)
    checkLookups(parsed, path)
    if (path.startsWith(`${root}/tasks/`) || path.startsWith(`${root}/handlers/`)) checkTasks(parsed, path, files, root)
    if (/\/meta\/main\.ya?ml$/.test(path)) {
      const meta = parsed
      if (mapping(meta) && meta.dependencies !== undefined && (!Array.isArray(meta.dependencies) || meta.dependencies.length)) throw new Error(`Unresolved role dependencies in ${path}`)
    }
  }
}
