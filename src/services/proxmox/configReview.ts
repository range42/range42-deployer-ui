export const CONFIG_FIELDS = ['name', 'description', 'cores', 'memory', 'tags'] as const
export type ConfigField = typeof CONFIG_FIELDS[number]
export type ConfigValues = Record<ConfigField, string | number | null>
export interface VmConfigReview {
  host_id: string
  node: string
  vmid: number
  vmtype: 'qemu' | 'lxc'
  digest: string
  target_digest: string
  current: ConfigValues
  configured: ConfigValues
  pending: ConfigField[]
}
export interface VmConfigResult {
  status: 'configured' | 'accepted' | 'unconfirmed'
  upid: string | null
  review: VmConfigReview | null
}

function mapping(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function validateConfigChanges(value: unknown): Partial<ConfigValues> {
  if (!mapping(value) || !Object.keys(value).length) throw new Error('Choose configuration changes to apply.')
  for (const [key, item] of Object.entries(value)) {
    if (!CONFIG_FIELDS.includes(key as ConfigField)) throw new Error('Unsupported configuration field.')
    if (key === 'cores' || key === 'memory') {
      if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < (key === 'cores' ? 1 : 16)
        || item > (key === 'cores' ? 128 : 4194304)) throw new Error(`Invalid configuration ${key}.`)
    } else {
      if (typeof item !== 'string') throw new Error(`Invalid configuration ${key}.`)
      if (key === 'name' && (item.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(item))) throw new Error('Invalid configuration name.')
      if (key === 'description' && (item.length > 8192 || [...item].some(character => (character.charCodeAt(0) < 32 && !['\n', '\t'].includes(character)) || character.charCodeAt(0) === 127)
        || item.toLowerCase().includes('range42-deployment:'))) throw new Error('Invalid configuration description.')
      if (key === 'tags') {
        const tags = item ? item.split(';') : []
        if (item.length > 1024 || new Set(tags).size !== tags.length || tags.some(tag => tag.length > 64 || !/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(tag))) throw new Error('Invalid configuration tags.')
      }
    }
  }
  return { ...value }
}

export function validateConfigReview(value: unknown, target: Pick<VmConfigReview, 'host_id' | 'node' | 'vmid' | 'vmtype'> & { target_digest?: string }): VmConfigReview {
  if (!mapping(value) || typeof value.host_id !== 'string' || !value.host_id || typeof value.node !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value.node) || typeof value.vmid !== 'number' || !Number.isSafeInteger(value.vmid) || value.vmid < 1
    || !['qemu', 'lxc'].includes(String(value.vmtype)) || value.host_id !== target.host_id || value.node !== target.node || value.vmid !== target.vmid
    || value.vmtype !== target.vmtype || typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest)
    || typeof value.target_digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.target_digest)
    || (target.target_digest !== undefined && value.target_digest !== target.target_digest)
    || !Array.isArray(value.pending) || value.pending.some(field => !CONFIG_FIELDS.includes(field as ConfigField))) throw new Error('Configuration review does not match the selected target.')
  for (const name of ['current', 'configured']) {
    const fields = value[name]
    if (!mapping(fields) || CONFIG_FIELDS.some(field => !Object.hasOwn(fields, field)
      || (fields[field] !== null && (['cores', 'memory'].includes(field)
        ? typeof fields[field] !== 'number' || !Number.isSafeInteger(fields[field]) || Number(fields[field]) < 0
        : typeof fields[field] !== 'string')))) throw new Error('Configuration review is incomplete.')
  }
  const fields = (name: string) => Object.fromEntries(CONFIG_FIELDS.map(field => [field, (value[name] as ConfigValues)[field]])) as ConfigValues
  return { host_id: value.host_id, node: value.node, vmid: value.vmid, vmtype: value.vmtype as VmConfigReview['vmtype'],
    digest: value.digest, target_digest: value.target_digest, current: fields('current'), configured: fields('configured'), pending: [...value.pending] as ConfigField[] }
}

export function validateConfigResult(value: unknown, target: VmConfigReview): VmConfigResult {
  if (!mapping(value) || !['configured', 'accepted', 'unconfirmed'].includes(String(value.status))) throw new Error('Configuration write outcome is unconfirmed.')
  const review = value.review === null ? null : validateConfigReview(value.review, target)
  if ((value.status === 'configured' && (!review || value.upid !== null))
    || (value.status === 'accepted' && (typeof value.upid !== 'string' || !value.upid.startsWith(`UPID:${target.node}:`)))
    || (value.upid !== null && typeof value.upid !== 'string')) throw new Error('Configuration write outcome is unconfirmed.')
  return { status: value.status as VmConfigResult['status'], upid: value.upid as string | null, review }
}
