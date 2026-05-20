import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  runMigration,
  buildProjectState,
  projectPathFor,
  slugifyProjectName,
  detectLegacyProjects,
  commitMigrationToStorage,
  shouldShowLegacyBanner,
  discardLegacyStorage,
  LEGACY_STORAGE_KEY,
  LEGACY_RENAMED_KEY,
  MIGRATION_COMPLETED_KEY,
} from '../services/projectRepo/migration.ts'

beforeEach(() => {
  localStorage.clear()
})

describe('migration helpers', () => {
  it('slugifies project names', () => {
    expect(slugifyProjectName('Hello World')).toBe('hello-world')
    expect(slugifyProjectName('  a-b-- ')).toBe('a-b')
    expect(slugifyProjectName('***')).toBe('project')
  })

  it('projectPathFor shared_repo_subdir uses projects/<slug>-<shortId>', () => {
    const p = { id: 'project_abc123456', name: 'My Lab' }
    expect(projectPathFor('shared_repo_subdir', p)).toBe('projects/my-lab-123456')
  })

  it('projectPathFor dedicated_repo returns empty root', () => {
    const p = { id: 'project_abc', name: 'Only' }
    expect(projectPathFor('dedicated_repo', p)).toBe('')
  })

  it('buildProjectState wraps overlay + canvas_layout + meta', () => {
    const p = { id: 'p1', name: 'X', nodes: [{ id: 'n1', position: { x: 1, y: 2 } }], edges: [] }
    const state = buildProjectState(p)
    expect(JSON.parse(state.overlay).nodes.length).toBe(1)
    expect(JSON.parse(state.canvas_layout).nodes[0].id).toBe('n1')
    expect(state.meta.id).toBe('p1')
    expect(state.meta.migrated_from).toBe('range42_projects')
  })

  it('detectLegacyProjects returns array from localStorage', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([{ id: 'a', name: 'A' }]))
    expect(detectLegacyProjects()).toEqual([{ id: 'a', name: 'A' }])
  })

  it('detectLegacyProjects handles missing/invalid JSON', () => {
    expect(detectLegacyProjects()).toEqual([])
    localStorage.setItem(LEGACY_STORAGE_KEY, '{not json')
    expect(detectLegacyProjects()).toEqual([])
  })
})

describe('runMigration', () => {
  it('calls adapter.autosave for each project and returns mapping', async () => {
    const autosave = vi.fn(() => Promise.resolve())
    const factory = vi.fn(() => ({
      load: vi.fn(),
      autosave,
      save: vi.fn(),
      acquireLock: vi.fn(),
      heartbeat: vi.fn(),
      onOrphanedDraft: vi.fn(),
      checkLockOwnership: vi.fn(),
    }))

    const projects = [
      { id: 'project_111aaa', name: 'Lab A', nodes: [], edges: [] },
      { id: 'project_222bbb', name: 'Lab B', nodes: [], edges: [] },
    ]
    const result = await runMigration(
      projects,
      {
        sourceId: 'src-1',
        repo: 'acme/lab',
        branch: 'main',
        strategy: 'shared_repo_subdir',
      },
      factory,
    )

    expect(factory).toHaveBeenCalledTimes(2)
    expect(autosave).toHaveBeenCalledTimes(2)
    expect(result.migrated).toHaveLength(2)
    expect(result.failed).toHaveLength(0)
    expect(result.migrated[0].source_id).toBe('src-1')
    expect(result.migrated[0].repo).toBe('acme/lab')
    expect(result.migrated[0].path).toBe('projects/lab-a-111aaa')
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('collects per-project failures without stopping', async () => {
    const autosave = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce(undefined)
    const factory = () => ({
      load: vi.fn(),
      autosave,
      save: vi.fn(),
      acquireLock: vi.fn(),
      heartbeat: vi.fn(),
      onOrphanedDraft: vi.fn(),
      checkLockOwnership: vi.fn(),
    })

    const projects = [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
      { id: 'p3', name: 'C' },
    ]

    const result = await runMigration(
      projects,
      { sourceId: 's', repo: 'a/b', branch: 'main', strategy: 'shared_repo_subdir' },
      factory,
    )
    expect(result.migrated).toHaveLength(2)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].project_id).toBe('p2')
    expect(result.failed[0].error).toBe('rate limited')
  })
})

describe('legacy storage handling', () => {
  it('commitMigrationToStorage renames legacy key and writes marker', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([{ id: 'a' }]))
    commitMigrationToStorage({
      migrated: [],
      failed: [],
      completedAt: '2026-04-14T10:00:00.000Z',
    })
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(null)
    expect(JSON.parse(localStorage.getItem(LEGACY_RENAMED_KEY))).toEqual([{ id: 'a' }])
    expect(localStorage.getItem(MIGRATION_COMPLETED_KEY)).toBe('2026-04-14T10:00:00.000Z')
  })

  it('shouldShowLegacyBanner respects 30-day window', () => {
    localStorage.setItem(LEGACY_RENAMED_KEY, '[]')
    localStorage.setItem(MIGRATION_COMPLETED_KEY, '2026-04-14T10:00:00.000Z')

    // 29 days after → show
    expect(shouldShowLegacyBanner(new Date('2026-05-13T10:00:00Z'))).toBe(true)
    // 31 days after → hide
    expect(shouldShowLegacyBanner(new Date('2026-05-15T10:00:01Z'))).toBe(false)
  })

  it('shouldShowLegacyBanner false when no legacy rename', () => {
    localStorage.setItem(MIGRATION_COMPLETED_KEY, new Date().toISOString())
    expect(shouldShowLegacyBanner()).toBe(false)
  })

  it('discardLegacyStorage removes the rename key', () => {
    localStorage.setItem(LEGACY_RENAMED_KEY, '[]')
    discardLegacyStorage()
    expect(localStorage.getItem(LEGACY_RENAMED_KEY)).toBe(null)
  })
})
