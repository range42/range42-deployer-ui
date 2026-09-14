import { parseDocument } from 'yaml'
import { fileText, validateFilePath, type ProjectFiles } from '@/services/projectFiles'

type ObjectValue = Record<string, unknown>
const composeNames = ['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml']
function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a mapping`)
  return value as ObjectValue
}
function yaml(value: string, label: string): ObjectValue {
  const doc = parseDocument(value)
  if (doc.errors.length) throw new Error(`Invalid YAML in ${label}; review the source before import`)
  return object(doc.toJS({ maxAliasCount: 50 }), label)
}
function keys(value: ObjectValue, allowed: string[], label: string): void {
  const unsupported = Object.keys(value).find(key => !allowed.includes(key))
  if (unsupported) throw new Error(`Unsupported ${label} field ${unsupported}; use a separately reviewed playbook for this workload`)
}
function literalPath(path: string): void {
  validateFilePath(path)
  if (!/^[A-Za-z0-9_.\-/]+$/.test(path)) throw new Error('Workload paths must be literal portable file paths without interpolation')
}
function imageReference(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(value) || value.includes('://')) throw new Error('Use a literal public image reference without interpolation or credentials')
  return value
}
function validateDockerfile(path: string, files: ProjectFiles): string[] {
  literalPath(path)
  if (!Object.hasOwn(files, path)) throw new Error(`Dockerfile dependency is missing with this exact case: ${path}`)
  if (Object.keys(files).some(name => name.endsWith('.dockerignore'))) throw new Error('Dockerfile ignore rules require separate build-dependency review')
  let stages = 0
  const images: string[] = []
  for (const line of fileText(files[path]).split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const [instruction, ...parts] = text.split(/\s+/), action = instruction.toUpperCase()
    if (text.endsWith('\\') || !['FROM', 'COPY', 'RUN', 'EXPOSE', 'CMD', 'ENTRYPOINT', 'WORKDIR', 'USER', 'STOPSIGNAL', 'LABEL'].includes(action)) throw new Error('Unsupported Dockerfile instruction or multiline build dependency')
    if (action === 'FROM') {
      if (++stages !== 1 || parts.length !== 1) throw new Error('Only a single literal Dockerfile build stage is supported')
      images.push(imageReference(parts[0]))
    }
    if (action === 'COPY') {
      let paths: unknown = parts
      if (text.slice(4).trim().startsWith('[')) { try { paths = JSON.parse(text.slice(4)) } catch { throw new Error('Invalid Dockerfile COPY dependency') } }
      if (!Array.isArray(paths) || paths.length < 2 || paths.some(value => typeof value !== 'string')) throw new Error('Invalid Dockerfile COPY dependency')
      for (const source of paths.slice(0, -1) as string[]) {
        const local = source.replace(/^\.\//, '').replace(/\/$/, '')
        literalPath(local)
        if (!Object.hasOwn(files, local) && !Object.keys(files).some(name => name.startsWith(`${local}/`))) throw new Error(`Dockerfile COPY dependency is missing: ${local}`)
      }
    }
  }
  if (stages !== 1) throw new Error('Dockerfile must declare exactly one image build stage')
  return images
}
function literal(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.includes('$') || value.includes('\0') || value.length > 4096) throw new Error(`Use a bounded literal ${label} without interpolation`)
  return value
}

function serviceExtras(config: ObjectValue, files: ProjectFiles, volumes: string[], names: string[]): string[] {
  if (config.environment !== undefined) {
    const env = object(config.environment, 'Compose environment')
    for (const [name, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Use literal environment names')
      if (/(?:^|_)(?:password|passwd|token|api_?key|secret|private_?key)(?:_|$)/i.test(name)) throw new Error('Environment secrets need runtime provisioning; do not publish secret values to Git')
      literal(value, 'environment value')
    }
  }
  if (config.volumes !== undefined) {
    if (!Array.isArray(config.volumes)) throw new Error('Use a list of literal volume mounts')
    const targets = new Set<string>()
    for (const mount of config.volumes) {
      const [source, target, mode, extra] = literal(mount, 'volume mount').split(':')
      if (!target?.startsWith('/') || target === '/' || extra || (mode !== undefined && !['ro', 'rw'].includes(mode))) throw new Error('Unsupported volume mount; choose a named volume or a read-only relative file')
      literalPath(target.slice(1))
      if (targets.has(target)) throw new Error('Duplicate volume mount target')
      targets.add(target)
      if (source.startsWith('./')) {
        const path = source.slice(2)
        literalPath(path)
        if (mode !== 'ro') throw new Error('Catalog bind mounts must be read-only')
        if (!Object.hasOwn(files, path) && !Object.keys(files).some(file => file.startsWith(`${path}/`))) throw new Error('Pinned bind mount dependency is missing')
      } else if (!volumes.includes(source)) throw new Error('Unsupported or undeclared volume mount; host paths are not imported')
    }
  }
  if (config.healthcheck !== undefined) {
    const health = object(config.healthcheck, 'Compose healthcheck')
    keys(health, ['test', 'interval', 'timeout', 'start_period', 'retries'], 'healthcheck')
    if (!Array.isArray(health.test) || health.test.length < 2 || !['CMD', 'CMD-SHELL'].includes(String(health.test[0]))) throw new Error('Use an explicit healthcheck command list')
    health.test.forEach(value => literal(value, 'healthcheck argument'))
    for (const field of ['interval', 'timeout', 'start_period']) if (health[field] !== undefined && !/^[1-9][0-9]{0,5}(?:ms|s|m)$/.test(String(health[field]))) throw new Error('Use a positive healthcheck duration in ms, s or m')
    if (health.retries !== undefined && (!Number.isInteger(health.retries) || Number(health.retries) < 1 || Number(health.retries) > 100)) throw new Error('Healthcheck retries must be between 1 and 100')
  }
  for (const key of ['command', 'entrypoint']) if (config[key] !== undefined) {
    if (!Array.isArray(config[key])) throw new Error(`Use a literal ${key} argument list`)
    config[key].forEach(value => literal(value, `${key} argument`))
  }
  if (config.depends_on === undefined) return []
  if (!Array.isArray(config.depends_on) || config.depends_on.some(name => typeof name !== 'string' || !names.includes(name))) throw new Error('Unsupported dependency: every depends_on service must exist in this workload')
  return config.depends_on as string[]
}

export function composeContract(files: ProjectFiles, hostPorts?: unknown) {
  const choices = composeNames.filter(path => Object.hasOwn(files, path))
  if (choices.length !== 1) throw new Error('Select a workload containing exactly one root Compose file; PoC metadata alone cannot run')
  const entrypoint = choices[0], document = yaml(fileText(files[entrypoint]), entrypoint)
  keys(document, ['services', 'version', 'volumes'], 'Compose')
  const services = object(document.services, 'Compose services'), names = Object.keys(services)
  if (!names.length || names.length > 32) throw new Error('Choose between 1 and 32 Compose services')
  const volumes = object(document.volumes === undefined ? {} : document.volumes, 'Compose volumes')
  for (const [name, value] of Object.entries(volumes)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(name)) throw new Error('Use literal volume names')
    keys(object(value === null ? {} : value, 'Compose volume'), [], 'volume; external names and drivers are not supported')
  }
  const dependencies = new Map<string, string[]>()
  const rows = names.map(service => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(service)) throw new Error('Use a literal Compose service name')
    const config = object(services[service], 'Compose service')
    keys(config, ['image', 'build', 'container_name', 'ports', 'restart', 'environment', 'volumes', 'healthcheck', 'depends_on', 'command', 'entrypoint'], 'Compose service')
    dependencies.set(service, serviceExtras(config, files, Object.keys(volumes), names))
    if (config.container_name !== undefined && (typeof config.container_name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(config.container_name))) throw new Error('Use a literal container name; the adapter assigns a project-scoped identity')
    if (config.restart !== undefined && !['no', 'always', 'on-failure', 'unless-stopped'].includes(String(config.restart))) throw new Error('Unsupported Compose restart policy')
    if ((config.image === undefined) === (config.build === undefined)) throw new Error('Choose one image or local build; combined image/build publishing needs separate review')
    let images: string[]
    if (config.image !== undefined) images = [imageReference(config.image)]
    else {
      const build = typeof config.build === 'string' ? { context: config.build } : object(config.build, 'Compose build')
      keys(build, ['context', 'dockerfile'], 'Compose build')
      if (build.context !== '.') throw new Error('Only the complete local workload build context "." is supported')
      if (build.dockerfile !== undefined && typeof build.dockerfile !== 'string') throw new Error('Dockerfile path must be literal')
      images = validateDockerfile(String(build.dockerfile || 'Dockerfile'), files)
    }
    if (config.ports !== undefined && !Array.isArray(config.ports)) throw new Error('Compose ports must be a literal list')
    const portMappings = (config.ports as unknown[] || []).map(value => {
      if (typeof value !== 'string' || !/^[0-9]+:[0-9]+(?:\/(?:tcp|udp))?$/.test(value)) throw new Error('Use literal host:container ports without interpolation, host addresses or ranges')
      const [host, target] = value.split(':'), [port, protocol = 'tcp'] = target.split('/')
      if (![host, port].every(number => Number(number) >= 1 && Number(number) <= 65535)) throw new Error('Compose ports must be between 1 and 65535')
      return { original_host_port: Number(host), host_port: Number(host), container_port: Number(port), protocol }
    })
    return { service, config, images, portMappings, build: config.build === undefined ? 'image' as const : 'local' as const }
  })
  const visited = new Set<string>(), visiting = new Set<string>()
  function visit(service: string) {
    if (visiting.has(service)) throw new Error('Compose dependency cycle must be resolved before importing')
    if (visited.has(service)) return
    visiting.add(service)
    for (const dependency of dependencies.get(service) || []) visit(dependency)
    visiting.delete(service); visited.add(service)
  }
  names.forEach(visit)
  const portMappings = rows.flatMap(row => row.portMappings)
  if (hostPorts !== undefined) {
    if (!Array.isArray(hostPorts) || hostPorts.length !== portMappings.length || hostPorts.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Supply one integer host port (1–65535) for each original port mapping')
    portMappings.forEach((mapping, index) => { mapping.host_port = hostPorts[index] })
  }
  const ports = portMappings.map(mapping => `${mapping.host_port}/${mapping.protocol}`)
  if (new Set(ports).size !== ports.length) throw new Error('A workload cannot publish the same host port twice')
  return { entrypoint, service: names.join(', '), services: names, rows, volumes: Object.keys(volumes), ports, portMappings, document,
    images: [...new Set(rows.flatMap(row => row.images))], build: rows.some(row => row.build === 'local') ? 'local' as const : 'image' as const,
    readiness: rows.every(row => row.config.healthcheck) ? 'All services must pass their declared healthchecks.' : 'Declared healthchecks must pass; services without a healthcheck are checked for running state only.' }
}
