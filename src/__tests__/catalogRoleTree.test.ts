import { describe, expect, it, vi } from 'vitest'
import { loadCatalogRoleFiles } from '@/services/catalogRoleTree'
import { assetFromBytes } from '@/services/projectFiles'
const path = '02_ansible_layer/admin/roles/software.install.example'
const sha = 'a'.repeat(40)
function source(files: Record<string, string | ReturnType<typeof assetFromBytes>>) {
  return { listTree: vi.fn(async () => Object.keys(files).map((file, index) => ({ path: `${path}/${file}`, type: 'blob' as const, mode: '100644', sha: `blob-${index}` }))),
    getFile: vi.fn(), getFileContent: vi.fn(async ({ path: file }: { path: string }) => ({ content: files[file.slice(path.length + 1)], sha: `blob-${Object.keys(files).indexOf(file.slice(path.length + 1))}` })) }
}
describe('pinned default catalog role files', () => {
  it('keeps the original role name and every nested file/byte at the selected SHA', async () => {
    const provider = source({ 'tasks/main.yml': '- name: example\n  ansible.builtin.copy:\n    src: tool.bin\n    dest: /tmp/tool.bin\n', 'files/tool.bin': assetFromBytes(new Uint8Array([0, 255, 13])), 'meta/main.yml': 'dependencies: []\n', 'README.md': '# original\n' })
    const files = await loadCatalogRoleFiles({ owner: 'range42', repo: 'catalog', path, sha }, provider)
    expect(files[`${path}/files/tool.bin`]).toEqual(assetFromBytes(new Uint8Array([0, 255, 13])))
    expect(Object.keys(files)).toHaveLength(4)
    expect(provider.getFileContent.mock.calls.every(([options]) => options.ref === sha)).toBe(true)
  })
  it('blocks external dependency declarations, missing assets and task includes by their path', async () => {
    await expect(loadCatalogRoleFiles({ owner: 'r', repo: 'c', path, sha }, source({ 'tasks/main.yml': '- import_role:\n    name: other.role\n' }))).rejects.toThrow(/other.role/)
    await expect(loadCatalogRoleFiles({ owner: 'r', repo: 'c', path, sha }, source({ 'tasks/main.yml': '- copy:\n    src: absent.bin\n    dest: /tmp/x\n' }))).rejects.toThrow(/absent.bin/)
    await expect(loadCatalogRoleFiles({ owner: 'r', repo: 'c', path, sha }, source({ 'tasks/main.yml': '- import_tasks: ../../../external.yml\n' }))).rejects.toThrow(/external.yml/)
  })
  it('blocks external include_vars and lookup file references before import', async () => {
    await expect(loadCatalogRoleFiles({ owner: 'r', repo: 'c', path, sha }, source({ 'tasks/main.yml': '- include_vars: /controller/private.yml\n' }))).rejects.toThrow(/private.yml/)
    await expect(loadCatalogRoleFiles({ owner: 'r', repo: 'c', path, sha }, source({ 'tasks/main.yml': `- debug:\n    msg: "{{ lookup('file', '/controller/private.txt') }}"\n` }))).rejects.toThrow(/lookup/)
  })
  it.each(['action: include_vars /controller/private.yml', 'local_action: command cat /controller/private.yml', 'with_file: /controller/private.yml', 'with_fileglob: /controller/*.key', 'with_first_found: /controller/private.yml', 'with_lines: cat /controller/private.yml'])('refuses unresolved alternate action/lookup syntax %s with the source path', async declaration => {
    await expect(loadCatalogRoleFiles({ owner: 'r', repo: 'c', path, sha }, source({ 'tasks/main.yml': `- debug:\n    msg: hello\n  ${declaration}\n` }))).rejects.toThrow(/tasks\/main.yml/)
  })
  it('preserves ordinary literal with_items loops', async () => {
    const tasks = '- debug:\n    msg: "{{ item }}"\n  with_items: [one, two]\n'
    expect((await loadCatalogRoleFiles({ owner: 'r', repo: 'c', path, sha }, source({ 'tasks/main.yml': tasks })))[`${path}/tasks/main.yml`]).toBe(tasks)
  })
  it.each(['120000', '100755', undefined])('rejects file mode %s rather than changing executable or symlink semantics', async mode => {
    const provider = source({ 'tasks/main.yml': '[]' })
    provider.listTree.mockResolvedValueOnce([{ path: `${path}/tasks/main.yml`, type: 'blob', mode, sha: 'blob-0' }])
    await expect(loadCatalogRoleFiles({ owner: 'r', repo: 'c', path, sha }, provider)).rejects.toThrow(/mode.*tasks\/main.yml/i)
  })
  it('rejects forged/out-of-role paths and duplicate trees instead of silently overwriting files', async () => {
    const provider = source({ 'tasks/main.yml': '[]' })
    provider.listTree.mockResolvedValueOnce([{ path: 'other/tasks/main.yml', type: 'blob', mode: '100644', sha: 'blob-0' }])
    await expect(loadCatalogRoleFiles({ owner: 'r', repo: 'c', path, sha }, provider)).rejects.toThrow(/outside/i)
  })
})
