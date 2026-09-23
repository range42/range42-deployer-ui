import { describe, it, expect } from 'vitest'
import { prepareEditorBranchRecovery, editorAuthoredSignature } from '@/services/gitEditorRecovery'

describe('editor orphan recovery', () => {
  it('keeps local files/settings and the old branch while creating a separate pinned working branch', () => {
    const project = { id: 'project', head_sha: 'a'.repeat(40), git: { source_id: 'source', provider: 'github', base_url: 'https://github.com', repo_owner: 'owner', repo_name: 'repo', branch_strategy: 'dedicated_repo', working_branch: 'old', publish_results: [{ status: 'published' }] }, files: { 'a.bin': { encoding: 'base64', content: 'AP8=', size: 2 } }, scenario: { setting: 'kept' } }
    const original = JSON.stringify(project)
    const binding = prepareEditorBranchRecovery(project)
    expect(binding).toMatchObject({ source_id: 'source', branch_from: 'a'.repeat(40), publish_results: [] })
    expect(binding.working_branch).not.toBe('old')
    expect(JSON.stringify(project)).toBe(original)
    expect(prepareEditorBranchRecovery(project).working_branch).not.toBe(binding.working_branch)
  })
  it('refuses recovery without a reviewed immutable source instead of adopting current remote HEAD', () => {
    expect(() => prepareEditorBranchRecovery({ git: { working_branch: 'old' } })).toThrow(/reopen|revision/i)
  })
  it('ignores observed status but preserves desired configuration in local autosave detection', () => {
    const graph = [{ id: 'vm', data: { config: { name: 'guest' }, desiredConfig: { cores: 2 }, status: 'running', actualConfig: { cores: 2 } } }]
    const before = editorAuthoredSignature(graph, [])
    graph[0].data.status = 'stopped'; graph[0].data.actualConfig.cores = 4
    expect(editorAuthoredSignature(graph, [])).toBe(before)
    graph[0].data.desiredConfig.cores = 4
    expect(editorAuthoredSignature(graph, [])).not.toBe(before)
  })
})
