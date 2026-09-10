/**
 * ProjectRepoAdapter — git-backed project state with IndexedDB offline cache.
 *
 * Spec §4: project documents live in a git repo; the adapter encapsulates
 * load / autosave / save plus lock acquisition + heartbeat coordination
 * (SharedWorker + navigator.locks come online in C1.11).
 *
 * NOTE: `SourceRecord` is defined here as a minimal local type because the
 * full `GitSource` model in `inventoryStore` lands in Task C2.1; this file
 * will switch to importing it once that task ships.
 */

import type { GitProviderV1 } from '@/services/git/types'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SourceRecord {
  id: string
  provider: 'github' | 'gitlab' | 'gitea' | 'generic'
  base_url?: string
  auth?: { kind: 'pat' | 'oauth'; ref_to_token_id?: string }
  repos?: Array<{
    owner: string
    repo: string
    branch: string
    manifest?: string
  }>
}

export interface ProjectState {
  overlay: string
  canvas_layout: string
  meta: Record<string, unknown>
  topology?: string
  /** Additional scenario or content files, relative to the project subdirectory. */
  files?: Record<string, string>
}

export interface LockInfo {
  editor_id: string
  browser_instance_id: string
  heartbeat_at: string
}

export type BranchStrategy = 'shared_repo_subdir' | 'dedicated_repo'

export interface ProjectRepoAdapter {
  load(projectId: string): Promise<ProjectState>
  autosave(projectId: string, state: ProjectState): Promise<void>
  /** Save checkpoints the working branch; publishing is always explicit. */
  save(projectId: string, message: string): Promise<{ commit_sha: string; branch: string }>
  stageFiles(projectId: string, files: Record<string, string>, message: string): Promise<void>
  proposeMerge(projectId: string, message: string): Promise<{ pr_url: string }>
  publishDirect(projectId: string, message: string): Promise<{ commit_sha: string; branch: string }>
  acquireLock(projectId: string): Promise<LockInfo>
  heartbeat(projectId: string): Promise<void>
  /**
   * Fired on tab-visibility restore when the remote .lock owner no longer
   * matches our browser_instance_id. Listener decides: merge, discard, or
   * save-as-new-draft.
   */
  onOrphanedDraft(cb: (draftId: string) => void): void
  /**
   * Called explicitly on document visibilitychange → visible; compares server
   * .lock owner vs our browser_instance_id; fires onOrphanedDraft if lost.
   */
  checkLockOwnership(projectId: string): Promise<'owner' | 'lost' | 'free'>
}

export interface AdapterConstructorOpts {
  provider: GitProviderV1
  source: SourceRecord
  branchStrategy: BranchStrategy
  projectPath: string
  browserInstanceId?: string
  workingBranch?: string
  branchFrom?: string
}

export { createProjectRepoAdapter } from './adapter'
export { openProjectDb } from './indexeddb'
