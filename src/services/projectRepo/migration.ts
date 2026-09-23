/**
 * localStorage → git migration (Plan C §4, Task C5.1).
 *
 * One-shot migration that takes the legacy `range42_projects` array, writes
 * each project's overlay + canvas_layout + meta to a git repo via a
 * ProjectRepoAdapter, and builds a new mapping of
 * `project_id → { source_id, repo, branch }` for the projectStore.
 *
 * Rules:
 *  - `range42_projects` is renamed to `range42_projects_legacy` (fallback
 *    window, see LegacyStorageBanner).
 *  - `range42_migration_completed_at` is set to the ISO timestamp.
 *  - Errors per-project are collected and returned; the migration never
 *    throws on an individual project — it continues and reports.
 */

import type { ProjectRepoAdapter, BranchStrategy } from './index'

export interface LegacyProject {
  id: string
  name: string
  created?: string
  modified?: string
  nodes?: unknown[]
  edges?: unknown[]
  overlay?: Record<string, unknown>
  [k: string]: unknown
}

export interface MigrationMapping {
  project_id: string
  source_id: string
  repo: string
  branch: string
  path: string
}

export interface MigrationResult {
  migrated: MigrationMapping[]
  failed: Array<{ project_id: string; name: string; error: string }>
  completedAt: string
}

export interface MigrationPlanOpts {
  sourceId: string
  repo: string
  branch: string
  strategy: BranchStrategy
  now?: () => Date
}

export interface AdapterFactory {
  (opts: {
    sourceId: string
    repo: string
    branch: string
    strategy: BranchStrategy
    projectPath: string
  }): ProjectRepoAdapter
}

export const LEGACY_STORAGE_KEY = 'range42_projects'
export const LEGACY_RENAMED_KEY = 'range42_projects_legacy'
export const MIGRATION_COMPLETED_KEY = 'range42_migration_completed_at'
export const LEGACY_FALLBACK_DAYS = 30

export function slugifyProjectName(name: string): string {
  const s = (name || '').trim().toLowerCase()
  const out = s.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return out || 'project'
}

export function projectPathFor(
  strategy: BranchStrategy,
  project: LegacyProject,
): string {
  const slug = slugifyProjectName(project.name)
  if (strategy === 'dedicated_repo') {
    // One project per repo: overlay lives at repo root.
    return ''
  }
  // shared_repo_subdir: projects/<slug>-<short-id>/
  const shortId = (project.id || '').replace(/^project_/, '').slice(-6) || 'xxxxxx'
  return `projects/${slug}-${shortId}`
}

export function detectLegacyProjects(): LegacyProject[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as LegacyProject[]) : []
  } catch {
    return []
  }
}

export function isMigrationComplete(): boolean {
  return !!localStorage.getItem(MIGRATION_COMPLETED_KEY)
}

/**
 * Returns true when the legacy fallback banner should still be shown.
 * The banner is visible while the rename key still exists AND the 30-day
 * window hasn't elapsed since `range42_migration_completed_at`.
 */
export function shouldShowLegacyBanner(now: Date = new Date()): boolean {
  const renamed = localStorage.getItem(LEGACY_RENAMED_KEY)
  if (!renamed) return false
  const ts = localStorage.getItem(MIGRATION_COMPLETED_KEY)
  if (!ts) return false
  const migratedAt = Date.parse(ts)
  if (Number.isNaN(migratedAt)) return false
  const ageMs = now.getTime() - migratedAt
  const maxMs = LEGACY_FALLBACK_DAYS * 24 * 60 * 60 * 1000
  return ageMs <= maxMs
}

export function discardLegacyStorage(): void {
  try {
    localStorage.removeItem(LEGACY_RENAMED_KEY)
  } catch {
    /* ignore */
  }
}

export function buildProjectState(project: LegacyProject): {
  overlay: string
  canvas_layout: string
  meta: Record<string, unknown>
} {
  const overlay = project.overlay || {
    nodes: project.nodes || [],
    edges: project.edges || [],
  }
  const canvas_layout = {
    version: 1,
    nodes: (project.nodes || []).map((n) => {
      const node = n as { id?: string; position?: unknown }
      return { id: node.id, position: node.position }
    }),
  }
  const meta = {
    id: project.id,
    name: project.name,
    created: project.created,
    modified: project.modified,
    migrated_from: 'range42_projects',
    migrated_at: new Date().toISOString(),
  }
  return {
    overlay: JSON.stringify(overlay, null, 2),
    canvas_layout: JSON.stringify(canvas_layout, null, 2),
    meta,
  }
}

/**
 * Execute the migration: for each legacy project, instantiate an adapter
 * and autosave overlay + canvas_layout + meta. Record the mapping.
 *
 * `factory` is injected to keep this pure — in production it wires the
 * real `createProjectRepoAdapter` with the chosen git source + provider.
 */
export async function runMigration(
  projects: LegacyProject[],
  opts: MigrationPlanOpts,
  factory: AdapterFactory,
): Promise<MigrationResult> {
  const migrated: MigrationMapping[] = []
  const failed: Array<{ project_id: string; name: string; error: string }> = []
  for (const project of projects) {
    try {
      const projectPath = projectPathFor(opts.strategy, project)
      const adapter = factory({
        sourceId: opts.sourceId,
        repo: opts.repo,
        branch: opts.branch,
        strategy: opts.strategy,
        projectPath,
      })
      const state = buildProjectState(project)
      await adapter.autosave(project.id, state)
      migrated.push({
        project_id: project.id,
        source_id: opts.sourceId,
        repo: opts.repo,
        branch: opts.branch,
        path: projectPath,
      })
    } catch (err) {
      failed.push({
        project_id: project.id,
        name: project.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const completedAt = (opts.now ? opts.now() : new Date()).toISOString()
  return { migrated, failed, completedAt }
}

/**
 * Commit the migration to localStorage: rename legacy key, write completion
 * marker, and persist mapping for the caller to adopt into projectStore.
 */
export function commitMigrationToStorage(result: MigrationResult): void {
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (legacy !== null) {
    try {
      localStorage.setItem(LEGACY_RENAMED_KEY, legacy)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  localStorage.setItem(MIGRATION_COMPLETED_KEY, result.completedAt)
  localStorage.setItem(
    'range42_migration_mapping',
    JSON.stringify(result.migrated),
  )
}
