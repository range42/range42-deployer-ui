import { describe, expect, it, vi } from 'vitest'
import { assetFromBytes, fileBytes, fileText } from '@/services/projectFiles'
import { buildCatalogContainer } from '@/services/catalogContainerAuthoring'
import { prepareCatalogWorkload } from '@/services/catalogWorkload'
import { savedScenario } from './fixtures/savedScenario'
const input = { target: 'training_web', description: 'Training web service', tags: 'web,linux,web', compose: 'services:\n  web:\n    image: nginx:alpine\n    ports: ["8080:80"]\n' }
describe('catalog container authoring', () => {
  it('authors native metadata and a complete tree that can be appended through the workload adapter', async () => {
    const draft = buildCatalogContainer(input)
    expect(draft.path).toBe('03_container_layer/docker/admin/training_web')
    const metadata = JSON.parse(fileText(draft.files[`${draft.path}/meta.json`]))
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
    const files = [{ path: 'Dockerfile', content: 'FROM nginx:alpine\nCOPY site /usr/share/nginx/html\n' }, { path: 'site/index.html', content: '<p>Training</p>' }]
    expect(buildCatalogContainer({ ...input, compose, files }).files).toHaveProperty('03_container_layer/docker/admin/training_web/site/index.html')
    expect(() => buildCatalogContainer({ ...input, compose, files: [] })).toThrow(/missing/)
  })
  it('authors and imports pictures byte-for-byte in the complete custom build context', async () => {
    const picture = assetFromBytes(new Uint8Array([137, 80, 78, 71, 0, 255, 10]), 'image/png')
    const draft = buildCatalogContainer({ ...input, compose: 'services: {web: {build: ., volumes: ["./site:/srv:ro"]}}', files: [
      { path: 'Dockerfile', content: 'FROM nginx:alpine\nCOPY site /usr/share/nginx/html\n' },
      { path: 'site/logo.png', content: picture },
    ] })
    expect(fileBytes(draft.files[`${draft.path}/site/logo.png`])).toEqual(fileBytes(picture))
    const project = savedScenario()
    const result = await prepareCatalogWorkload({ project, scenario: project.scenario, targetNode: 'vm1', attachmentId: 'pictures',
      source: { id: 'catalog', provider: 'github', base_url: 'https://github.com', auth: { kind: 'none' }, repos: [{ owner: 'range42', repo: 'catalog', branch: 'dev' }] },
      entry: { source_id: 'catalog', kind: 'container', name: draft.name, path: draft.path, sha: 'a'.repeat(40) } }, {
      listTree: vi.fn(async () => Object.keys(draft.files).map(path => ({ path, type: 'blob', mode: '100644', sha: 'b'.repeat(40) }))),
      getFileContent: vi.fn(async ({ path }) => ({ content: draft.files[path], sha: 'b'.repeat(40) })), getFile: vi.fn(),
    })
    expect(fileBytes(result.files['scenarios/saved/content/workloads/pictures/payload/site/logo.png'])).toEqual(fileBytes(picture))
  })
  it.each(['.env', 'settings.yml', 'Dockerfile'])('rejects binary executable configuration at %s', path => {
    expect(() => buildCatalogContainer({ ...input, files: [{ path, content: assetFromBytes(new Uint8Array([0, 255])) }] })).toThrow(/configuration|text/)
  })
  it('does not let base64 wrapped text bypass secret checks', () => {
    expect(() => buildCatalogContainer({ ...input, files: [{ path: 'config.txt', content: assetFromBytes(new TextEncoder().encode('password: never-publish')) }] })).toThrow(/secret/i)
  })
  it('rejects malformed binary data before publication', () => {
    expect(() => buildCatalogContainer({ ...input, files: [{ path: 'logo.png', content: { encoding: 'base64', content: 'AA==', size: 2 } }] })).toThrow(/size/)
  })
  it('publishes only explicit secret placeholders with operator setup instructions', () => {
    const draft = buildCatalogContainer({ ...input, compose: 'services:\n  db:\n    image: postgres:17\n    environment:\n      POSTGRES_PASSWORD: ${DB_PASSWORD}\n', secretNames: 'DB_PASSWORD' })
    expect(draft.files[`${draft.path}/README.md`]).toContain('DB_PASSWORD')
    expect(draft.files[`${draft.path}/README.md`]).toContain('vault')
  })
  it.each([
    { target: '../escape' }, { description: '' }, { compose: 'services: {}' },
    { compose: 'services: {web: {image: nginx, privileged: true}}' },
    { files: [{ path: '.env', content: 'PASSWORD=example' }] }, { files: [{ path: '../escape', content: 'x' }] },
    { files: [{ path: 'compose.yml', content: 'services: {}' }] }, { files: [{ path: 'bad', content: '\0binary' }] },
    { files: [{ path: 'private.pem', content: '-----BEGIN PRIVATE KEY-----' }] },
    { secretNames: 'DOCKER_HOST' }, { secretNames: 'MISSING' },
  ])('rejects invalid or unsupported authoring input before publication: %j', patch => {
    expect(() => buildCatalogContainer({ ...input, ...patch })).toThrow()
  })
  it('refuses duplicate file rows before collapsing them into a file map', () => {
    expect(() => buildCatalogContainer({ ...input, files: [{ path: 'site/index.html', content: 'first' }, { path: 'site/index.html', content: 'second' }] })).toThrow(/duplicate/i)
  })
  it('validates per-file byte limits for explicitly authored text', () => {
    expect(() => buildCatalogContainer({ ...input, files: [{ path: 'large.txt', content: 'x'.repeat(1024 * 1024 + 1) }] })).toThrow(/1 MiB/)
  })
  it('refuses existing component directories', () => {
    expect(() => buildCatalogContainer(input, ['03_container_layer/docker/admin/training_web/README.md'])).toThrow(/already exists/)
  })
})
