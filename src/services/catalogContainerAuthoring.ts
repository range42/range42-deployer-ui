import type { CatalogRoleDraft } from './catalogRoleAuthoring'
import { composeContract } from './catalogCompose'
import { assertWorkloadFileSafe } from './catalogWorkload'
import { validateFileMap } from './projectFiles'
export interface CatalogContainerInput { target: string; description: string; tags: string; compose: string; files?: string; secretNames?: string }

/** Use the existing catalog Docker directory and the same contract as project import. */
export function buildCatalogContainer(input: CatalogContainerInput, existingPaths: Iterable<string> = []): CatalogRoleDraft {
  const name = input.target.trim(), description = input.description.trim()
  if (!/^[a-z][a-z0-9_-]{0,62}$/.test(name)) throw new Error('Use a lowercase workload name with letters, numbers, underscores or hyphens (at most 63 characters).')
  if (!description || description.length > 4096) throw new Error('A description of at most 4096 characters is required.')
  const path = `03_container_layer/docker/admin/${name}`
  if ([...existingPaths].some(existing => existing === path || existing.startsWith(`${path}/`))) throw new Error(`The workload ${name} already exists. Choose another name.`)
  let extra: unknown
  try { extra = JSON.parse(input.files?.trim() || '{}') } catch { throw new Error('Additional files must be a JSON object of relative paths and text contents.') }
  validateFileMap(extra)
  const reserved = new Set(['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml', 'meta.json', 'range42.yaml', 'README.md'])
  for (const [file, content] of Object.entries(extra)) {
    if (reserved.has(file) || typeof content !== 'string') throw new Error('Additional files must be text and cannot replace generated Compose, metadata or README files.')
  }
  const secrets = [...new Set((input.secretNames || '').split(',').map(name => name.trim()).filter(Boolean))]
  if (secrets.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^(?:ansible_|proxmox_|r42_|global_|deployer_cli_|RANGE42_|DOCKER_|COMPOSE_|PATH$|HOME$|LD_|PYTHON)/i.test(name))) throw new Error('Use non-reserved secret placeholder names, never secret values.')
  const payload: Record<string, string> = { ...extra as Record<string, string>, 'compose.yml': `${input.compose.trim()}\n` }
  const contract = composeContract(payload, undefined, Object.fromEntries(secrets.map(name => [name, name])))
  const tags = [...new Set(input.tags.split(',').map(tag => tag.trim()).filter(Boolean))]
  payload['meta.json'] = JSON.stringify({ x_range42: { exercise: { id: name, version: '1.0.0', type: 'docker-compose', container: true },
    catalog: { path, tags, status: 'active', description } } }, null, 2) + '\n'
  payload['README.md'] = `# ${name}\n\n${description}\n\n## Deployment\n\nAdd this catalog item to a project and select its target VM. The guest must already have Docker Engine and Docker Compose with --wait support. Review the generated files and published ports before applying them. Save the project branch, then run Configure on the deployment.\n\n${contract.readiness}\n\n${secrets.length ? `Bind these Compose placeholders to secret project variables in the append dialog: ${secrets.join(', ')}. An operator must provision those variables in the backend workspace vault. Never save secret values to this repository.\n\n` : ''}Cleanup is an explicit reviewed playbook. It preserves named volumes, images and copied files. Mutable image tags do not pin registry content.\n`
  for (const [file, content] of Object.entries(payload)) assertWorkloadFileSafe(file, content)
  const files = Object.fromEntries(Object.entries(payload).map(([file, content]) => [`${path}/${file}`, content]))
  validateFileMap(files)
  return { name, path, files }
}
