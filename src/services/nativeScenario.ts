import type { GitProviderV1 } from '@/services/git/types'
import type { ProjectGitBinding } from '@/composables/useProjectGitSync'
import type { ProjectState } from '@/services/projectRepo'
import { readFileContent } from '@/services/git/fileContent'
import { fileText, fileBytes, MAX_PROJECT_FILE_BYTES, validateAuthoredFiles, validateFilePath, type ProjectFiles, type FileContent } from '@/services/projectFiles'

const reserved = ['meta.json', 'topology.json', 'canvas_layout.json', 'overlay.json', '.lock']
function editablePath(path: string): boolean {
  validateFilePath(path)
  return !reserved.includes(path) && !path.split('/').some(part => ['secrets', 'ssh_keys', '.env', '.lock'].includes(part))
}

export interface NativeScenario { version: 1; path: string }

export function nativeScenario(value: unknown): NativeScenario {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('path' in value) || typeof value.path !== 'string') throw new Error('Invalid native scenario metadata')
  validateFilePath(value.path)
  return { version: 1, path: value.path }
}

/** Read only the selected scenario; its complete repository remains pinned in Git. */
export async function loadNativeScenario(binding: ProjectGitBinding, selected: string, provider: GitProviderV1,
  pinned?: string): Promise<ProjectState> {
  const native = nativeScenario({ version: 1, path: selected })
  const prefix = binding.subdir ? `${binding.subdir}/` : ''
  const revision = pinned || (await provider.listCommits({ owner: binding.repo_owner, repo: binding.repo_name,
    ref: binding.branch || 'main', perPage: 1 }))[0]?.sha
  if (!revision || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revision)) throw new Error('Native scenario requires an exact commit SHA')
  const repo = { owner: binding.repo_owner, repo: binding.repo_name, ref: revision }
  const tree = await provider.listTree(repo)
  if (tree.some(item => reserved.some(name => item.path === `${prefix}${name}`))) {
    let owned = false
    const metadata = tree.find(item => item.path === `${prefix}meta.json` && ['100644', '100755'].includes(item.mode || ''))
    if (metadata) {
      const saved = JSON.parse(fileText((await readFileContent(provider, { ...repo, path: metadata.path })).content))
      if (saved?.ui_project?.version === 1 && saved.ui_project.native_scenario) {
        nativeScenario(saved.ui_project.native_scenario)
        owned = true
      }
    }
    if (!owned) throw new Error('This directory already contains unrelated project metadata. Open it as a saved project or choose a different repository root.')
  }
  const base = `${prefix}${native.path}/`
  const editable = tree.filter(item => item.path.startsWith(base) && item.type === 'blob'
    && ['100644', '100755'].includes(item.mode || '')
    && editablePath(item.path.slice(prefix.length)))
  for (const entry of editable) validateFilePath(entry.path)
  if (!editable.some(item => [base + 'main.yml', base + 'main.yaml'].includes(item.path))
    || !editable.some(item => item.path === base + 'manifest/scenario_vms.json')) {
    throw new Error('Choose a native scenario directory with main.yml and manifest/scenario_vms.json as regular files.')
  }
  const files: ProjectFiles = {}
  // The full tree stays in Git. The Config editor reads additional files lazily;
  // browser editing limits must never turn into a scenario deployment limit.
  const priority = (path: string) => path.endsWith('/manifest/scenario_vms.json') ? 0
    : [base + 'main.yml', base + 'main.yaml'].includes(path) ? 1 : path.includes('/manifest/') ? 2 : 3
  editable.sort((a, b) => priority(a.path) - priority(b.path))
  let total = 0
  const read = async (item: typeof editable[number]) => {
    const name = item.path.slice(prefix.length)
    try {
      const { content } = await readFileContent(provider, { ...repo, path: item.path })
      return { name, content }
    } catch (error) {
      if (name.endsWith('/manifest/scenario_vms.json') || !(error instanceof Error) || !/1 MiB|per-file limit|too large/i.test(error.message)) throw error
      return null
    }
  }
  const initial = editable.slice(0, 128)
  for (let offset = 0; offset < initial.length; offset += 8) {
    const batch = await Promise.all(initial.slice(offset, offset + 8).map(read))
    for (const item of batch) {
      if (!item) continue
      const size = fileBytes(item.content).byteLength
      if (total + size <= MAX_PROJECT_FILE_BYTES) { files[item.name] = item.content; total += size }
    }
  }
  validateAuthoredFiles(files)
  const manifest = JSON.parse(fileText(files[`${native.path}/manifest/scenario_vms.json`]!))
  if (!manifest || !Array.isArray(manifest.vms) || manifest.vms.some((vm: unknown) => !vm || typeof vm !== 'object'
    || !('vm_id' in vm) || !Number.isInteger(vm.vm_id) || Number(vm.vm_id) <= 0)) throw new Error('Native scenario VM manifest is invalid')
  const name = native.path.split('/').at(-1)!
  return { revision: { branch: binding.branch || 'main', commit_sha: revision }, files,
    overlay: '{}', canvas_layout: '{}', topology: JSON.stringify({ schema_version: '1.0', kind: 'lab', name, nodes: [] }),
    meta: { name, ui_project: { version: 1, native_scenario: native, generated_paths: [], variables: [] } } }
}

type TreeEntry = { path: string; type: 'blob' | 'tree'; sha: string; mode?: string }
interface EditableFs {
  listTree(): Promise<TreeEntry[]>
  getFile?(path: string): Promise<{ content: FileContent; sha: string }>
  getFileContent?(path: string): Promise<{ content: FileContent; sha: string }>
  putFile(input: { path: string; content: FileContent; message?: string }): Promise<unknown>
}

/** One editable view: local changes override lazily read, SHA-pinned repo files. */
export function createNativeFilesFs(binding: ProjectGitBinding, revision: string, provider: GitProviderV1, local: EditableFs) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revision)) throw new Error('Native repository editing requires a saved revision')
  const prefix = binding.subdir ? `${binding.subdir}/` : ''
  const repo = { owner: binding.repo_owner, repo: binding.repo_name, ref: revision }
  let pending: Promise<TreeEntry[]> | undefined
  const remote = () => pending ||= provider.listTree(repo).then(tree => tree
    .filter(item => item.path.startsWith(prefix) && item.type === 'blob' && ['100644', '100755'].includes(item.mode || ''))
    .map(item => ({ ...item, path: item.path.slice(prefix.length) })).filter(item => editablePath(item.path)))
    .catch(error => { pending = undefined; throw error })
  return {
    async listTree() {
      const [base, changed] = await Promise.all([remote(), local.listTree()])
      return [...new Map([...base, ...changed].map(item => [item.path, item])).values()]
    },
    async getFile(path: string) {
      if (!editablePath(path)) throw new Error('Context credentials and project metadata cannot be edited here')
      const changed = await local.listTree()
      if (changed.some(item => item.path === path)) {
        const read = local.getFileContent || local.getFile
        if (!read) throw new Error('Local file reader is unavailable')
        return read.call(local, path)
      }
      if (!(await remote()).some(item => item.path === path)) throw new Error('Repository file not found')
      return readFileContent(provider, { ...repo, path: prefix + path })
    },
    async putFile(input: { path: string; content: FileContent; message?: string }) {
      if (!editablePath(input.path)) throw new Error('Context credentials and project metadata cannot be edited here')
      return local.putFile(input)
    },
  }
}
