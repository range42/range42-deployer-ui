/** Opt-in local Docker/Ansible acceptance. Uses a cached image, no published ports or hypervisor. */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { parse, stringify } from 'yaml'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { reviewCatalogWorkload } from '@/services/catalogWorkload'
import { assetFromBytes, fileBytes } from '@/services/projectFiles'
import { customSimulation, pictureBytes } from './fixtures/customSimulation'

const backend = process.env.R42_WORKLOAD_BACKEND
describe.skipIf(!backend || process.env.R42_WORKLOAD_REAL_DOCKER !== '1')('custom application with actual Docker and Ansible', () => {
  it('serves custom binary assets, applies revised content including removals, then removes owned containers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r42-custom-docker-'))
    const { project, result } = await customSimulation(root.split('/').at(-1))
    const prefix = 'scenarios/saved/content/workloads/web', guest = join(root, 'guest')
    const composeProject = result.summary.compose_project, container = result.summary.container_names[0]
    const localPort = await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') { server.close(); reject(new Error('Missing local test port')); return }
        server.close(error => error ? reject(error) : resolve(address.port))
      })
    })
    const python = join(backend!, '.venv/bin/python'), ansible = join(backend!, '.venv/bin/ansible-playbook')
    const docker = (args: string[]) => execFileSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], { timeout: 20000 })
    const existingContainers = docker(['ps', '--all', '--format', '{{.ID}}']).toString().trim().split('\n').filter(Boolean).sort()
    docker(['image', 'inspect', 'nginx:stable-alpine']) // Missing cache is a prerequisite failure, never a pull.
    const writeScenario = (current: typeof project) => {
      const generated = emitConcreteScenario({ ...current, generatedPaths: current.scenario_generated_paths,
        runtimeCapabilities: { available: true, bootstrap_features: ['extra_nics', 'resources'] } })
      expect(JSON.parse(generated.files['scenarios/saved/manifest/scenario_vms.json'] as string).vms[0].nics).toHaveLength(2)
      for (const [path, content] of Object.entries(generated.files)) {
        const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, fileBytes(content))
      }
      // Validate actual emitted project files using the backend before remapping guest destinations.
      execFileSync(python, ['-c', 'from pathlib import Path; import sys; from app.core.project import resolve_project_scenario; resolve_project_scenario(Path(sys.argv[1]), scenario_label="saved", scope="configure")', root], { cwd: backend, timeout: 20000 })
      // The target guest has its own IP; localhost acceptance uses only an ephemeral loopback port.
      const runtimeSource = generated.files[`${prefix}/runtime.compose.yml`] as string
      const runtime = parse(runtimeSource)
      expect(runtime.services.web.ports).toEqual(['18089:80/tcp'])
      runtime.services.web.ports = [`127.0.0.1:${localPort}:80/tcp`]
      const localRuntime = stringify(runtime)
      writeFileSync(join(root, prefix, 'runtime.compose.yml'), localRuntime)
      const hash = (text: string) => createHash('sha256').update(text).digest('hex')
      for (const filename of ['deploy.yml', 'cleanup.yml']) {
        const plays = parse((generated.files[`${prefix}/${filename}`] as string).replaceAll('/opt/range42/workloads', guest).replaceAll(hash(runtimeSource), hash(localRuntime)))
        plays[0].become = false
        writeFileSync(join(root, prefix, filename), stringify(plays, { lineWidth: 0 }))
      }
      mkdirSync(join(root, 'active/secrets'), { recursive: true })
      writeFileSync(join(root, 'active/secrets/default_vault.yml'), '{}\n')
      writeFileSync(join(root, 'inventory.yml'), stringify({ all: { hosts: { 'saved-vm': { ansible_connection: 'local', ansible_python_interpreter: python } } } }))
      writeFileSync(join(root, 'ansible.cfg'), '[defaults]\n')
    }
    const run = (cleanup = false) => {
      try {
        execFileSync(ansible, ['-i', join(root, 'inventory.yml'), join(root, prefix, cleanup ? 'cleanup.yml' : 'deploy.yml'), '-e', 'global_vm_ssh_name=saved-vm'], {
          cwd: root, timeout: 90000, env: { ...process.env, ANSIBLE_CONFIG: join(root, 'ansible.cfg'), ANSIBLE_STDOUT_CALLBACK: 'default', ANSIBLE_NOCOLOR: '1', ANSIBLE_LOCAL_TEMP: join(root, 'ansible-tmp'), RANGE42_ACTIVE_CONFIG_DIR: join(root, 'active') },
        })
      } catch (reason) { throw new Error(String((reason as { stdout?: Buffer }).stdout || reason)) }
    }
    try {
      writeScenario(project); run()
      expect(docker(['exec', container, 'wget', '-qO-', 'http://127.0.0.1/logo.png'])).toEqual(Buffer.from(pictureBytes))
      expect(Buffer.from(await (await fetch(`http://127.0.0.1:${localPort}/logo.png`)).arrayBuffer())).toEqual(Buffer.from(pictureBytes))
      expect(docker(['exec', container, 'wget', '-qO-', 'http://127.0.0.1/']).toString()).toContain('Custom simulation')
      const updatedPicture = Uint8Array.from([...pictureBytes, 10])
      project.files[`${prefix}/payload/site/logo.png`] = assetFromBytes(updatedPicture, 'image/png')
      project.files[`${prefix}/payload/site/index.html`] = '<h1>Updated simulation</h1>\n'
      delete project.files[`${prefix}/payload/site/old.txt`]
      const updated = await reviewCatalogWorkload({ project, scenario: project.scenario, attachmentId: 'web' })
      writeScenario({ ...project, files: updated.files, scenario: updated.scenario }); run()
      expect(docker(['exec', container, 'wget', '-qO-', 'http://127.0.0.1/logo.png'])).toEqual(Buffer.from(updatedPicture))
      expect(Buffer.from(await (await fetch(`http://127.0.0.1:${localPort}/logo.png`)).arrayBuffer())).toEqual(Buffer.from(updatedPicture))
      expect(docker(['exec', container, 'wget', '-qO-', 'http://127.0.0.1/']).toString()).toContain('Updated simulation')
      expect(existsSync(join(guest, composeProject, 'payload/site/old.txt'))).toBe(false)
      run(true)
      expect(docker(['ps', '--all', '--filter', `name=^/${container}$`, '--quiet']).toString().trim()).toBe('')
      expect(docker(['network', 'ls', '--filter', `name=^${composeProject}_default$`, '--quiet']).toString().trim()).toBe('')
      expect(existsSync(join(guest, composeProject, 'payload/site/logo.png'))).toBe(true)
    } finally {
      // Cleanup is restricted to this test's generated random identity.
      const owner = result.summary.compose_project.replace(/^r42-/, '')
      if (owner.length === 24) {
        const owned = docker(['ps', '--all', '--filter', `name=^/${container}$`, '--quiet']).toString().trim()
        if (owned) docker(['rm', '--force', container])
        const network = docker(['network', 'ls', '--filter', `name=^${composeProject}_default$`, '--quiet']).toString().trim()
        if (network) docker(['network', 'rm', `${composeProject}_default`])
      }
      rmSync(root, { recursive: true, force: true })
      expect(docker(['ps', '--all', '--format', '{{.ID}}']).toString().trim().split('\n').filter(Boolean).sort()).toEqual(existingContainers)
    }
  }, 240000)
})
