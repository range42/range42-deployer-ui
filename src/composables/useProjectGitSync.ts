/**
 * useProjectGitSync — on-demand "serialize canvas → push to git → pin SHA".
 *
 * Unlike useProjectRepo (which binds an editor session to a repo at mount with
 * lock heartbeats), this is a lifecycle-free action invoked when the operator
 * explicitly saves/deploys. It serializes the live canvas into the canonical
 * topology.json (via the tested overlay serializer), autosaves it to the
 * project's draft branch, and promotes it to the deploy branch — returning the
 * resulting commit SHA the backend will clone+checkout.
 */

import { getProvider } from '@/services/git'
import { createProjectRepoAdapter } from '@/services/projectRepo'
import { buildProjectState } from '@/overlay/projectState'
import { useInventoryStore } from '@/stores/inventoryStore'
import type { CanvasModel, ProjectMeta } from '@/overlay/serialize'
import type { BranchStrategy } from '@/services/projectRepo'

export interface ProjectGitBinding {
  /** Matches both the UI inventoryStore source id (for the PAT) and the
   *  backend Source row id, so UI push and backend clone agree. */
  source_id: string
  provider: 'github' | 'gitlab' | 'gitea' | 'generic'
  base_url: string
  repo_owner: string
  repo_name: string
  branch?: string
  branch_strategy: BranchStrategy
  /** Subdirectory for shared_repo_subdir; '' (root) for dedicated_repo. */
  subdir?: string
}

export interface PushToGitArgs {
  projectId: string
  binding: ProjectGitBinding
  canvas: CanvasModel
  meta: ProjectMeta
  message?: string
}

/**
 * Map a stored project + the live canvas graph into PushToGitArgs. Returns null
 * when the project has no git binding (so callers skip the git push and fall
 * back to local-only persistence). Pure — no IO — so it stays unit-testable
 * outside the editor component.
 */
export function buildPushArgs(
  project: {
    id: string
    name: string
    git?: ProjectGitBinding
    gamenet?: boolean
    bridge_base?: number
    attachments?: unknown[]
  },
  nodes: unknown[],
  edges: unknown[],
  message?: string,
): PushToGitArgs | null {
  if (!project?.git) return null
  return {
    projectId: project.id,
    binding: project.git,
    canvas: {
      nodes: (nodes ?? []) as CanvasModel['nodes'],
      edges: (edges ?? []) as CanvasModel['edges'],
      attachments: (project.attachments ?? []) as CanvasModel['attachments'],
    },
    meta: {
      name: project.name,
      kind: project.gamenet ? 'gamenet' : 'lab',
      bridge_base: project.bridge_base,
    },
    message: message ?? `Save ${project.name}`,
  }
}

export function useProjectGitSync() {
  const inventory = useInventoryStore()

  async function pushToGit(
    args: PushToGitArgs,
  ): Promise<{ commit_sha?: string; pr_url?: string }> {
    const { projectId, binding, canvas, meta, message } = args
    // 'generic' sources speak the Gitea API surface.
    const providerKind = binding.provider === 'generic' ? 'gitea' : binding.provider
    const provider = getProvider(providerKind, {
      baseUrl: binding.base_url,
      token: inventory.getToken(binding.source_id),
    })
    const adapter = createProjectRepoAdapter({
      provider,
      source: {
        id: binding.source_id,
        provider: binding.provider,
        base_url: binding.base_url,
        repos: [
          {
            owner: binding.repo_owner,
            repo: binding.repo_name,
            branch: binding.branch ?? 'main',
          },
        ],
      },
      branchStrategy: binding.branch_strategy,
      projectPath: binding.subdir ?? '',
    })

    const state = buildProjectState(canvas, meta)
    await adapter.autosave(projectId, state)
    return adapter.save(projectId, message ?? `Update ${meta.name}`)
  }

  return { pushToGit }
}
