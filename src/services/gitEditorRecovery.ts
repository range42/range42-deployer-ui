import { randomId } from '@/services/randomId'
import type { ProjectGitBinding } from '@/composables/useProjectGitSync'

export function prepareEditorBranchRecovery(project: { git?: ProjectGitBinding; head_sha?: string }): ProjectGitBinding {
  const revision = project.head_sha || project.git?.branch_from
  if (!project.git || !revision || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revision)) throw new Error('Reopen the remote project to obtain a reviewed immutable revision before creating a recovery branch.')
  return { ...JSON.parse(JSON.stringify(project.git)), branch_from: revision,
    working_branch: `range42-ui/recovery-${randomId()}`, publish_results: [] }
}

export function editorAuthoredSignature(nodes: unknown[], edges: unknown[]): string {
  const captured = JSON.parse(JSON.stringify({ nodes, edges }))
  for (const node of captured.nodes) if (node?.data) {
    for (const field of ['status', 'statusError', 'actualConfig', 'liveMetrics', 'pendingAction']) delete node.data[field]
  }
  return JSON.stringify(captured)
}
