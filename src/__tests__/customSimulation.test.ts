import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { customSimulation } from './fixtures/customSimulation'

describe('custom multi-network application compilation', () => {
  it('preserves both NICs and resource choices for a supporting native bootstrap', async () => {
    const { project } = await customSimulation()
    const result = emitConcreteScenario({ ...project, generatedPaths: project.scenario_generated_paths,
      runtimeCapabilities: { available: true, bootstrap_features: ['extra_nics', 'resources'] } })
    const bootstrap = parse(result.files['scenarios/saved/01_vm_bootstrap.yml'] as string)[0].vars
    expect(bootstrap).toMatchObject({ global_vm_extra_config: {
      net1: 'virtio,bridge=saved2', ipconfig1: 'ip=10.42.8.10/24', cores: 2, memory: 2048,
    } })
    expect(JSON.parse(result.files['scenarios/saved/manifest/scenario_vms.json'] as string).vms[0].nics).toHaveLength(2)
  })

  it('refuses to generate executable files from application changes that have not been reviewed', async () => {
    const { project } = await customSimulation()
    project.files['scenarios/saved/content/workloads/web/payload/site/index.html'] = '<h1>Unreviewed update</h1>'
    expect(() => emitConcreteScenario({ ...project, generatedPaths: project.scenario_generated_paths })).toThrow(/review|changed/i)
  })
})
