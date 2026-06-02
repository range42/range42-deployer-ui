/**
 * useProjectRepo composable (C1.10).
 *
 * Wires the ProjectRepoAdapter into Vue reactivity:
 *  - instantiates the provider + adapter for a given projectId
 *  - exposes reactive `state` + `status`
 *  - binds `visibilitychange` → `checkLockOwnership`, firing the orphaned
 *    draft callback on lock loss (spec §4)
 */

import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { getProvider } from '@/services/git'
import { useInventoryStore } from '@/stores/inventoryStore'
import {
  createProjectRepoAdapter,
  type ProjectRepoAdapter,
  type ProjectState,
  type SourceRecord,
  type BranchStrategy,
} from '@/services/projectRepo'

export type RepoStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'saving'
  | 'error'
  | 'lock-lost'

export interface UseProjectRepoOpts {
  projectId: string
  source: SourceRecord
  projectPath: string
  branchStrategy?: BranchStrategy
  browserInstanceId?: string
}

export function useProjectRepo(opts: UseProjectRepoOpts) {
  const state = ref<ProjectState>({
    overlay: '',
    canvas_layout: '',
    meta: {},
  })
  const status = ref<RepoStatus>('idle')
  const error = ref<Error | null>(null)
  const adapter = shallowRef<ProjectRepoAdapter | null>(null)
  const orphanedDraftId = ref<string | null>(null)

  // 'generic' sources speak the Gitea API; github/gitlab/gitea map directly now
  // that the GitHub v1 provider is implemented.
  const providerKind = opts.source.provider === 'generic' ? 'gitea' : opts.source.provider
  const inventory = useInventoryStore()
  const provider = getProvider(providerKind, {
    baseUrl: opts.source.base_url,
    token: inventory.getToken(opts.source.id),
  })
  adapter.value = createProjectRepoAdapter({
    provider,
    source: opts.source,
    branchStrategy: opts.branchStrategy ?? 'shared_repo_subdir',
    projectPath: opts.projectPath,
    browserInstanceId: opts.browserInstanceId,
  })

  adapter.value.onOrphanedDraft((draftId) => {
    orphanedDraftId.value = draftId
    status.value = 'lock-lost'
  })

  async function load(): Promise<void> {
    status.value = 'loading'
    try {
      state.value = await adapter.value!.load(opts.projectId)
      status.value = 'ready'
    } catch (e) {
      error.value = e as Error
      status.value = 'error'
    }
  }

  async function save(message: string): Promise<{ pr_url?: string; commit_sha?: string }> {
    status.value = 'saving'
    try {
      const res = await adapter.value!.save(opts.projectId, message)
      status.value = 'ready'
      return res
    } catch (e) {
      error.value = e as Error
      status.value = 'error'
      throw e
    }
  }

  async function autosave(newState: ProjectState): Promise<void> {
    state.value = newState
    try {
      await adapter.value!.autosave(opts.projectId, newState)
    } catch (e) {
      error.value = e as Error
      status.value = 'error'
    }
  }

  const onVisibilityChange = async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      try {
        const ownership = await adapter.value!.checkLockOwnership(opts.projectId)
        if (ownership === 'lost') {
          // `lock-lost` status is set via onOrphanedDraft callback registered
          // in the adapter; callers decide how to recover (merge / discard /
          // save-as-new-draft). Pending IDB commits must NOT be flushed yet.
          status.value = 'lock-lost'
        }
      } catch {
        // transient; leave status alone
      }
    }
  }

  onMounted(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    void load()
  })

  onUnmounted(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  })

  return {
    adapter,
    state,
    status,
    error,
    orphanedDraftId,
    load,
    save,
    autosave,
  }
}
