import { describe, expect, it, vi } from 'vitest'
import { buildCatalogContainer } from '@/services/catalogContainerAuthoring'
import { prepareCatalogWorkload } from '@/services/catalogWorkload'
import { savedScenario } from './fixtures/savedScenario'
const input = { target: 'training_web', description: 'Training web service', tags: 'web,linux,web', compose: 'services:\n  web:\n    image: nginx:alpine\n    ports: ["8080:80"]\n' }
describe('catalog container authoring', () => {
  it('authors native metadata and a complete tree that can be appended through the workload adapter', async () => {
    const draft = buildCatalogContainer(input)
    expect(draft.path).toBe('03_container_layer/docker/admin/training_web')
    const metadata = JSON.parse(draft.files[`${draft.path}/meta.json`])
    expect(metadata.x_range42.catalog.tags).toEqual(['web', 'linux'])
    expect(metadata.x_range42.exercise.id).toBe('training_web')
    const project = savedScenario(), source = { id: 'catalog', provider: 'github' as const, base_url: 'https://github.com', auth: { kind: 'none' as const }, repos: [{ owner: 'range42', repo: 'catalog', branch: 'dev' }] }
    const result = await prepareCatalogWorkload({ project, scenario: project.scenario, targetNode: 'vm1', attachmentId: 'authored', source,
      entry: { source_id: 'catalog', kind: 'container', name: draft.name, path: draft.path, sha: 'a'.repeat(40), document: metadata } }, {
      listTree: vi.fn(async () => Object.keys(draft.files).map(path => ({ path, type: 'blob', mode: '100644', sha: 'b'.repeat(40) }))),
      getFileContent: vi.fn(async ({ path }) => ({ content: draft.files[path], sha: 'b'.repeat(40) })), getFile: vi.fn(),
    })
    expect(result.summary.services).toEqual(['web'])
    expect(result.summary.published_ports).toEqual(['8080/tcp'])
  })
  it('validates complete local build and read-only mount dependencies before review', () => {
    const compose = 'services:\n  web:\n    build: .\n    volumes: ["./site:/srv:ro"]\n'
    const files = JSON.stringify({ Dockerfile: 'FROM nginx:alpine\nCOPY site /usr/share/nginx/html\n', 'site/index.html': '<p>Training</p>' })
    expect(buildCatalogContainer({ ...input, compose, files }).files).toHaveProperty('03_container_layer/docker/admin/training_web/site/index.html')
    expect(() => buildCatalogContainer({ ...input, compose, files: '{}' })).toThrow(/missing/)
  })
  it('publishes only explicit secret placeholders with operator setup instructions', () => {
    const draft = buildCatalogContainer({ ...input, compose: 'services:\n  db:\n    image: postgres:17\n    environment:\n      POSTGRES_PASSWORD: ${DB_PASSWORD}\n', secretNames: 'DB_PASSWORD' })
    expect(draft.files[`${draft.path}/README.md`]).toContain('DB_PASSWORD')
    expect(draft.files[`${draft.path}/README.md`]).toContain('vault')
  })
  it.each([
    { target: '../escape' }, { description: '' }, { compose: 'services: {}' },
    { compose: 'services: {web: {image: nginx, privileged: true}}' },
    { files: '{".env":"PASSWORD=example"}' }, { files: '{"../escape":"x"}' },
    { files: '{"compose.yml":"services: {}"}' }, { files: '{"bad":{}}' },
    { files: '{"private.pem":"-----BEGIN PRIVATE KEY-----"}' },
    { secretNames: 'DOCKER_HOST' }, { secretNames: 'MISSING' },
  ])('rejects invalid or unsupported authoring input before publication: %j', patch => {
    expect(() => buildCatalogContainer({ ...input, ...patch })).toThrow()
  })
  it('refuses existing component directories', () => {
    expect(() => buildCatalogContainer(input, ['03_container_layer/docker/admin/training_web/README.md'])).toThrow(/already exists/)
  })
})
