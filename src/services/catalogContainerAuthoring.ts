import { composeContract } from './catalogCompose'
import { assertWorkloadFileSafe } from './catalogWorkload'
import { cloneFiles, validateFileMap, validateFilePath, type FileContent, type ProjectFiles } from './projectFiles'
export interface CatalogContainerFile { path: string; content: FileContent }
export interface CatalogContainerDraft { name: string; path: string; files: ProjectFiles }
export interface CatalogContainerInput { target: string; description: string; tags: string; compose: string; files?: CatalogContainerFile[]; secretNames?: string }

/** Use the existing catalog Docker directory and the same contract as project import. */
export function buildCatalogContainer(input: CatalogContainerInput, existingPaths: Iterable<string> = []): CatalogContainerDraft {
  const name = input.target.trim(), description = input.description.trim()
  if (!/^[a-z][a-z0-9_-]{0,62}$/.test(name)) throw new Error('Use a lowercase workload name with letters, numbers, underscores or hyphens (at most 63 characters).')
  if (!description || description.length > 4096) throw new Error('A description of at most 4096 characters is required.')
  const path = `03_container_layer/docker/admin/${name}`
  if ([...existingPaths].some(existing => existing === path || existing.startsWith(`${path}/`))) throw new Error(`The workload ${name} already exists. Choose another name.`)
  const rows = input.files ?? []
  if (!Array.isArray(rows)) throw new Error('Additional files must be rows with a relative path and file content.')
  const reserved = new Set(['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml', 'meta.json', 'range42.yaml', 'README.md'])
  const paths = new Set<string>()
  const extra = Object.fromEntries(rows.map(row => {
    if (!row || typeof row.path !== 'string') throw new Error('Additional files must have a relative path and file content.')
    const file = row.path.trim()
    validateFilePath(file)
    if (reserved.has(file)) throw new Error(`Additional files cannot replace generated Compose, metadata or README files: ${file}.`)
    if (paths.has(file)) throw new Error(`Duplicate file path: ${file}. Each file must appear only once.`)
    paths.add(file)
    return [file, row.content] as const
  }))
  validateFileMap(extra)
  const secrets = [...new Set((input.secretNames || '').split(',').map(name => name.trim()).filter(Boolean))]
  if (secrets.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^(?:ansible_|proxmox_|r42_|global_|deployer_cli_|RANGE42_|DOCKER_|COMPOSE_|PATH$|HOME$|LD_|PYTHON)/i.test(name))) throw new Error('Use non-reserved secret placeholder names, never secret values.')
  const payload: ProjectFiles = { ...extra, 'compose.yml': `${input.compose.trim()}\n` }
  const contract = composeContract(payload, undefined, Object.fromEntries(secrets.map(name => [name, name])))
  const tags = [...new Set(input.tags.split(',').map(tag => tag.trim()).filter(Boolean))]
  payload['meta.json'] = JSON.stringify({ x_range42: { exercise: { id: name, version: '1.0.0', type: 'docker-compose', container: true },
    catalog: { path, tags, status: 'active', description } } }, null, 2) + '\n'
  payload['README.md'] = `# ${name}\n\n${description}\n\n## Deployment\n\nAdd this catalog item to a project and select its target VM. The guest must already have Docker Engine and Docker Compose with --wait support. Review the generated files and published ports before applying them. Save the project branch, then run Configure on the deployment.\n\n${contract.readiness}\n\n${secrets.length ? `Bind these Compose placeholders to secret project variables in the append dialog: ${secrets.join(', ')}. An operator must provision those variables in the backend workspace vault. Never save secret values to this repository.\n\n` : ''}Cleanup is an explicit reviewed playbook. It preserves named volumes, images and copied files. Mutable image tags do not pin registry content.\n`
  for (const [file, content] of Object.entries(payload)) assertWorkloadFileSafe(file, content)
  const files = Object.fromEntries(Object.entries(payload).map(([file, content]) => [`${path}/${file}`, content]))
  validateFileMap(files)
  return { name, path, files: cloneFiles(files) }
}
