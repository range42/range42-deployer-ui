import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import CatalogAppendDialog from '@/components/catalog/CatalogAppendDialog.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import catalog from '@/locales/en/catalog.json'

const { getEntry, prepare } = vi.hoisted(() => ({ getEntry: vi.fn(), prepare: vi.fn() }))
vi.mock('@/composables/useCatalog', () => ({ useCatalog: () => ({ getEntry }) }))
vi.mock('@/services/catalogProjectAppend', () => ({ prepareCatalogAppend: prepare }))
vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn() }))
vi.mock('focus-trap-vue', () => ({ FocusTrap: { template: '<div><slot /></div>' } }))
enableAutoUnmount(afterEach)

const entry = { name: 'Vulnerable VM', kind: 'component', source_id: 'source', path: 'machines/web', sha: 'a'.repeat(40) }
const original = { id: 'project_one', name: 'Training', nodes: [{ id: 'existing', type: 'vm', data: { config: { template: 9901 } } }], edges: [], files: { 'notes.txt': 'keep' }, git: { repo_owner: 'owner', repo_name: 'lab', working_branch: 'range42-ui/one' } }

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks()
  getEntry.mockResolvedValue(structuredClone(entry))
  prepare.mockImplementation(async ({ project }) => ({ project: { ...project, nodes: [...project.nodes, { id: 'web', type: 'vm', data: { label: 'Web', config: { template: 9902, cores: 2, memory: 2048 } } }] }, addedNodeIds: ['web'], counts: { nodes: 1, edges: 0, attachments: 0, roles: 0, files: 0 }, warnings: [] }))
})
afterEach(() => vi.unstubAllGlobals())

async function modal(props = {}) {
  const pinia = createPinia(); setActivePinia(pinia)
  const inventory = useInventoryStore()
  inventory.sources = [{ id: 'source', provider: 'github', base_url: 'https://github.com', auth: { kind: 'none' }, repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }] }]
  const projects = useProjectStore()
  projects.importProject(structuredClone(original), { generateNewId: false })
  const wrapper = mount(CatalogAppendDialog, { props: { entry, initialProjectId: original.id, ...props }, global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: { catalog } } })] } })
  await flushPromises()
  return { wrapper, projects, inventory }
}
async function review(wrapper) {
  await wrapper.get('[data-testid="catalog-append-review"]').trigger('click')
  await flushPromises()
}

describe('append catalog review', () => {
  it('prefills the requested project and previews typed VM settings before persisting a local addition', async () => {
    const { wrapper, projects } = await modal()
    expect(wrapper.get('[name="project"]').element.value).toBe(original.id)
    await review(wrapper)
    expect(projects.getProject(original.id).nodes).toHaveLength(1)
    expect(wrapper.get('[data-testid="catalog-append-preview"]').text()).toContain('9902')
    await wrapper.get('[data-testid="catalog-append-open"]').trigger('click')
    const saved = projects.getProject(original.id)
    expect(saved.nodes).toHaveLength(2)
    expect(saved.git).toEqual(original.git)
    expect(saved.files).toEqual(original.files)
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].nodes).toHaveLength(2)
    expect(wrapper.emitted('added')[0][0]).toMatchObject({ projectId: original.id, nodeId: 'web', open: true })
  })
  it('preserves changed project data and refuses applying an obsolete preview', async () => {
    const { wrapper, projects } = await modal()
    await review(wrapper)
    projects.updateProject(original.id, { name: 'Changed during review' })
    await flushPromises()
    expect(wrapper.find('[data-testid="catalog-append-open"]').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toMatch(/changed/i)
    expect(projects.getProject(original.id).nodes).toHaveLength(1)
  })
  it('ignores a response arriving after cancellation', async () => {
    let finish
    getEntry.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { wrapper, projects } = await modal()
    await wrapper.get('[data-testid="catalog-append-review"]').trigger('click')
    await wrapper.get('[data-testid="catalog-append-close"]').trigger('click')
    finish(entry); await flushPromises()
    expect(prepare).not.toHaveBeenCalled()
    expect(projects.getProject(original.id).nodes).toHaveLength(1)
  })
  it('refuses a refreshed origin revision without applying old selection metadata', async () => {
    getEntry.mockResolvedValueOnce({ ...entry, sha: 'b'.repeat(40) })
    const { wrapper, projects } = await modal()
    await review(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toMatch(/refresh|revision/i)
    expect(prepare).not.toHaveBeenCalled()
    expect(projects.getProject(original.id).nodes).toHaveLength(1)
  })
  it('preserves the project on storage failure and allows the same reviewed addition to retry', async () => {
    const { wrapper, projects } = await modal()
    await review(wrapper)
    const storage = localStorage
    vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('quota') } })
    await wrapper.get('[data-testid="catalog-append-open"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toMatch(/storage/i)
    expect(projects.getProject(original.id).nodes).toHaveLength(1)
    vi.unstubAllGlobals()
    await wrapper.get('[data-testid="catalog-append-open"]').trigger('click')
    expect(projects.getProject(original.id).nodes).toHaveLength(2)
  })
  it('does not silently substitute another project when the requested target is missing', async () => {
    const { wrapper } = await modal({ initialProjectId: 'deleted' })
    expect(wrapper.get('[name="project"]').element.value).toBe('')
    await review(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toMatch(/project/i)
    expect(prepare).not.toHaveBeenCalled()
  })
  it('prefills an explicit VM for a role and opens its actual added file', async () => {
    const role = { ...entry, kind: 'ansible_role' }
    getEntry.mockResolvedValueOnce(role)
    prepare.mockImplementationOnce(async ({ project }) => ({ project, addedNodeIds: [], counts: { nodes: 0, edges: 0, attachments: 1, roles: 1, files: 2 }, warnings: [], selectedFile: 'roles/example/tasks/main.yml' }))
    const { wrapper } = await modal({ entry: role, initialNodeId: 'existing' })
    expect(wrapper.get('[name="target-node"]').element.value).toBe('existing')
    await review(wrapper)
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ targetNode: 'existing' }))
    await wrapper.get('[data-testid="catalog-append-open"]').trigger('click')
    expect(wrapper.emitted('added')[0][0]).toMatchObject({ nodeId: 'existing', tab: 'config', file: 'roles/example/tasks/main.yml' })
  })
  it('rejects an origin credential change before applying the reviewed addition', async () => {
    const { wrapper, projects, inventory } = await modal()
    await review(wrapper)
    inventory.setToken('source', 'fixture-new-token')
    await wrapper.get('[data-testid="catalog-append-open"]').trigger('click')
    expect(projects.getProject(original.id).nodes).toHaveLength(1)
    expect(wrapper.get('[role="alert"]').text()).toMatch(/changed/i)
  })
  it('reviews explicit workload host ports and shows the effective image and mapping', async () => {
    const container = { ...entry, kind: 'container' }
    getEntry.mockResolvedValueOnce(container)
    prepare.mockImplementationOnce(async ({ project }) => ({ project, addedNodeIds: [], counts: { nodes: 0, edges: 0, attachments: 1, roles: 0, files: 4 }, warnings: [], review: { service: 'web', images: ['httpd:2.4'], build: 'image', destination: '/opt/range42/workloads/example', port_mappings: [{ host_port: 8081, container_port: 80, protocol: 'tcp' }], prerequisites: ['Docker Compose'], limitations: [] } }))
    const { wrapper } = await modal({ entry: container, initialNodeId: 'existing' })
    await wrapper.get('[name="host-ports"]').setValue('8081')
    await review(wrapper)
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ hostPorts: [8081] }))
    expect(wrapper.get('[data-testid="catalog-workload-preview"]').text()).toContain('httpd:2.4')
    expect(wrapper.get('[data-testid="catalog-workload-preview"]').text()).toContain('8081 → 80/tcp')
  })
})
