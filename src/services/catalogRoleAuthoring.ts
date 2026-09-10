/** Generate standard catalog role files without performing any repository writes. */
import { parseDocument, stringify } from 'yaml'

export interface CatalogRoleInput {
  category: string
  action: string
  target: string
  description: string
  tags: string
  tasks: string
  defaults?: string
}

export interface CatalogRoleDraft {
  name: string
  path: string
  files: Record<string, string>
}

export class CatalogRoleValidationError extends Error {
  constructor(public field: keyof CatalogRoleInput, message: string) {
    super(message)
    this.name = 'CatalogRoleValidationError'
  }
}

function readYaml(field: 'tasks' | 'defaults', content: string): unknown {
  const doc = parseDocument(content)
  if (doc.errors.length) {
    throw new CatalogRoleValidationError(field, `${field} YAML: ${doc.errors[0].message}`)
  }
  try {
    return doc.toJS({ maxAliasCount: 50 })
  } catch {
    throw new CatalogRoleValidationError(field, `${field} YAML contains too many aliases.`)
  }
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function buildCatalogRole(input: CatalogRoleInput, existingPaths: Iterable<string> = []): CatalogRoleDraft {
  const parts = ['category', 'action', 'target'] as const
  const names = parts.map((field) => {
    const value = input[field].trim()
    const pattern = field === 'target' ? /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/ : /^[a-z][a-z0-9_-]*$/
    if (!pattern.test(value)) {
      throw new CatalogRoleValidationError(field, `Use a lowercase ${field} name with letters, numbers, underscores or hyphens${field === 'target' ? '; dots may separate target names' : ''}.`)
    }
    return value
  })
  const name = names.join('.')
  if (name.length > 128) throw new CatalogRoleValidationError('target', 'The role name must be at most 128 characters.')
  const path = `02_ansible_layer/admin/roles/${name}`
  for (const existing of existingPaths) {
    if (existing === path || existing.startsWith(`${path}/`)) {
      throw new CatalogRoleValidationError('target', `The role ${name} already exists. Choose another name.`)
    }
  }
  const description = input.description.trim()
  if (!description) throw new CatalogRoleValidationError('description', 'A description is required.')
  const tasks = readYaml('tasks', input.tasks)
  if (!Array.isArray(tasks) || !tasks.length || tasks.some((task) => !isMapping(task) || !Object.keys(task).length)) {
    throw new CatalogRoleValidationError('tasks', 'Tasks must be a nonempty YAML list of task mappings.')
  }
  if (tasks.some((task) => ['hosts', 'tasks', 'roles', 'import_playbook'].some((key) => key in task))) {
    throw new CatalogRoleValidationError('tasks', 'Enter Ansible tasks here, rather than a playbook with hosts or roles.')
  }
  const defaultsContent = input.defaults?.trim() || '{}'
  if (!isMapping(readYaml('defaults', defaultsContent))) {
    throw new CatalogRoleValidationError('defaults', 'Defaults must be a YAML mapping of variable names to values.')
  }
  const tags = [...new Set(input.tags.split(',').map((tag) => tag.trim()).filter(Boolean))]
  return {
    name,
    path,
    files: {
      [`${path}/tasks/main.yml`]: `${input.tasks.trim()}\n`,
      [`${path}/meta/main.yml`]: stringify({ galaxy_info: { description, galaxy_tags: tags }, dependencies: [] }),
      [`${path}/defaults/main.yml`]: `${defaultsContent}\n`,
      [`${path}/README.md`]: `# ${name}\n\n${description}\n\n## Usage\n\nInclude this role in a scenario configuration play after its target hosts are ready.\nDeclare configurable variables in \`defaults/main.yml\` and override them at the call site.\n`,
    },
  }
}
