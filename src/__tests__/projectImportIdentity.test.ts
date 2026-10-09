import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'
import { reviewCatalogWorkload } from '@/services/catalogWorkload'
import { customSimulation } from './fixtures/customSimulation'

const asFile = (project: unknown) => new File([JSON.stringify(project)], 'simulation.json', { type: 'application/json' })

describe('managed workload project file import', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })

  it('preserves ownership and binary assets so an exported application can still be reviewed', async () => {
    const { project } = await customSimulation()
    const store = useProjectStore()
    const imported = await store.importProjectFromFile(asFile(project))
    expect(imported.id).toBe(project.id)
    expect(imported.files).toEqual(project.files)
    expect(JSON.parse(localStorage.getItem('range42_projects')!)[0].id).toBe(project.id)
    const reviewed = await reviewCatalogWorkload({ project: JSON.parse(JSON.stringify(imported)), scenario: imported.scenario, attachmentId: 'web' })
    const prefix = `scenarios/${project.scenario.label}/content/workloads/web`
    expect(reviewed.files[`${prefix}/runtime.compose.yml`]).toBe(project.files[`${prefix}/runtime.compose.yml`])
    expect(reviewed.files[`${prefix}/payload/site/logo.png`]).toEqual(project.files[`${prefix}/payload/site/logo.png`])
  })

  it('preserves ownership when an exported payload has edits awaiting review', async () => {
    const { project } = await customSimulation()
    const payload = `scenarios/${project.scenario.label}/content/workloads/web/payload/site/index.html`
    project.files[payload] = '<h1>Updated application</h1>'
    const imported = await useProjectStore().importProjectFromFile(asFile(project))
    const reviewed = await reviewCatalogWorkload({ project: JSON.parse(JSON.stringify(imported)), scenario: imported.scenario, attachmentId: 'web' })
    expect(imported.id).toBe(project.id)
    expect(reviewed.files[payload]).toBe(project.files[payload])
  })

  it('refuses duplicate managed identity without changing the existing project or storage', async () => {
    const { project } = await customSimulation()
    const store = useProjectStore()
    store.importProject(project, { generateNewId: false })
    const before = localStorage.getItem('range42_projects')
    await expect(store.importProjectFromFile(asFile(project))).rejects.toThrow(/open the existing project.*export.*remove/i)
    expect(store.projects).toHaveLength(1)
    expect(localStorage.getItem('range42_projects')).toBe(before)
  })

  it.each(['changed identity', 'missing identity', 'missing review', 'incomplete review'])('refuses %s instead of adopting another workload owner', async reason => {
    const { project } = await customSimulation()
    const candidate = JSON.parse(JSON.stringify(project))
    if (reason === 'changed identity') candidate.id = 'unrelated-project'
    if (reason === 'missing identity') delete candidate.id
    if (reason === 'missing review') delete candidate.files[`scenarios/${project.scenario.label}/content/workloads/web/review.json`]
    if (reason === 'incomplete review') {
      const reviewPath = `scenarios/${project.scenario.label}/content/workloads/web/review.json`
      const review = JSON.parse(candidate.files[reviewPath])
      candidate.files[reviewPath] = JSON.stringify({ version: review.version, compose_project: review.compose_project })
    }
    const store = useProjectStore()
    await expect(store.importProjectFromFile(asFile(candidate))).rejects.toThrow(/ownership|original project ID|review/i)
    expect(store.projects).toHaveLength(0)
    expect(localStorage.getItem('range42_projects')).toBeNull()
  })

  it('continues to import ordinary duplicate projects with a fresh identity', async () => {
    const store = useProjectStore()
    const ordinary = { id: 'ordinary', name: 'Ordinary', nodes: [], edges: [] }
    store.importProject(ordinary, { generateNewId: false })
    const imported = await store.importProjectFromFile(asFile(ordinary))
    expect(imported.id).not.toBe(ordinary.id)
    expect(store.projects).toHaveLength(2)
  })
})
