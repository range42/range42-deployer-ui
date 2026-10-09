import { savedScenario } from './savedScenario'
import { buildCatalogContainer } from '@/services/catalogContainerAuthoring'
import { prepareCatalogWorkload } from '@/services/catalogWorkload'
import { assetFromBytes } from '@/services/projectFiles'

export const pictureBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='), char => char.charCodeAt(0))

export async function customSimulation(projectId = 'custom-simulation') {
  const project = savedScenario()
  project.id = projectId
  project.name = 'Custom application simulation'
  project.scenario.content = []
  project.scenario.networks.push({ id: 'net2', vnet: 'saved2', subnet: '10.42.8.0/24', gateway: '10.42.8.1', snat: false })
  project.scenario.vms[0].nics.push({ network_id: 'net2', ip: '10.42.8.10' })
  project.nodes.push({ id: 'net2', type: 'network-segment', position: { x: 430, y: 310 }, data: { config: {} } })
  project.edges.push({ id: 'nic2', source: 'vm1', target: 'net2', type: 'network', data: { connection: {} } })
  const draft = buildCatalogContainer({ target: 'custom_web', description: 'Custom website with an image', tags: 'training',
    compose: 'services:\n  web:\n    image: nginx:stable-alpine\n    ports: ["18089:80"]\n    healthcheck:\n      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1/"]\n      interval: 1s\n      timeout: 2s\n      retries: 20\n    volumes: ["./site:/usr/share/nginx/html:ro", "./site/logo.png:/usr/share/nginx/html/logo.png:ro"]\n',
    files: [{ path: 'site/index.html', content: '<h1>Custom simulation</h1><img src="logo.png">\n' },
      { path: 'site/logo.png', content: assetFromBytes(pictureBytes, 'image/png') }, { path: 'site/old.txt', content: 'Remove this on update\n' }],
  })
  const entry = { source_id: 'catalog', kind: 'container', name: 'Custom web', path: draft.path, sha: 'a'.repeat(40) }
  const source = { id: 'catalog', provider: 'github' as const, base_url: 'https://github.com', auth: { kind: 'none' as const }, repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'main' }] }
  const tree = Object.keys(draft.files).map(path => ({ path, mode: '100644', type: 'blob' as const, sha: 'b'.repeat(40) }))
  const result = await prepareCatalogWorkload({ project, scenario: project.scenario, attachmentId: 'web', targetNode: 'vm1', entry, source }, {
    listTree: async () => tree, getFile: async () => { throw new Error('Use byte-preserving reads') }, getFileContent: async ({ path }) => ({ content: draft.files[path], sha: 'b'.repeat(40) }),
  })
  return { project: { ...project, files: result.files, scenario: result.scenario }, result, entry, source, tree, sourceFiles: draft.files }
}
