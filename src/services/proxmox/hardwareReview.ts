export interface HardwareNic {
  id: string; model: string | null; mac: string | null; bridge: string | null
  tag: number | null; firewall: boolean; link_down: boolean; editable: boolean
}
export interface HardwareDisk {
  id: string; size_bytes: number | null; pool: string | null; volume_fingerprint: string | null; editable: boolean
}
export interface HardwareValues { nics: HardwareNic[]; disks: HardwareDisk[] }
export interface HardwareReview {
  host_id: string; node: string; vmid: number; vmtype: 'qemu'; digest: string; target_digest: string
  current: HardwareValues; configured: HardwareValues; pending: string[]
}
export type NicChanges = Partial<Pick<HardwareNic, 'bridge' | 'tag' | 'firewall' | 'link_down'>>
export interface HardwareResult {
  status: 'configured' | 'accepted' | 'unconfirmed'; upid: string | null; review: HardwareReview | null
}
const NIC = /^net(?:[0-9]|[12][0-9]|3[01])$/
const DISK = /^(?:ide[0-3]|scsi(?:[0-9]|[12][0-9]|30)|virtio(?:[0-9]|1[0-5])|sata[0-5])$/
const HASH = /^[a-f0-9]{64}$/
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
const nullableText = (value: unknown, limit: number) => value === null || typeof value === 'string' && value.length <= limit

export function validateNicChanges(value: unknown): NicChanges {
  if (!record(value) || !Object.keys(value).length) throw new Error('Choose NIC changes to review.')
  for (const [key, item] of Object.entries(value)) {
    if (key === 'bridge' && typeof item === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,14}$/.test(item)) continue
    if (key === 'tag' && (item === null || typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= 4094)) continue
    if (['firewall', 'link_down'].includes(key) && typeof item === 'boolean') continue
    throw new Error('Unsupported or invalid NIC change.')
  }
  return { ...value }
}

function values(value: unknown): HardwareValues {
  if (!record(value) || !Array.isArray(value.nics) || value.nics.length > 32 || !Array.isArray(value.disks) || value.disks.length > 64) throw new Error('Hardware observations are incomplete.')
  const nics = value.nics.map(row => {
    if (!record(row) || typeof row.id !== 'string' || !NIC.test(row.id) || !nullableText(row.model, 32) || !nullableText(row.mac, 17)
      || !nullableText(row.bridge, 15) || !(row.tag === null || typeof row.tag === 'number' && Number.isInteger(row.tag) && row.tag >= 1 && row.tag <= 4094)
      || typeof row.firewall !== 'boolean' || typeof row.link_down !== 'boolean' || typeof row.editable !== 'boolean'
      || row.editable && (typeof row.model !== 'string' || !row.model || typeof row.mac !== 'string' || !/^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/.test(row.mac))) throw new Error('NIC observation is incomplete.')
    return { id: row.id, model: row.model, mac: row.mac, bridge: row.bridge, tag: row.tag, firewall: row.firewall, link_down: row.link_down, editable: row.editable } as HardwareNic
  })
  const disks = value.disks.map(row => {
    if (!record(row) || typeof row.id !== 'string' || !DISK.test(row.id) || !nullableText(row.pool, 64)
      || !(row.size_bytes === null || typeof row.size_bytes === 'number' && Number.isSafeInteger(row.size_bytes) && row.size_bytes > 0)
      || !(row.volume_fingerprint === null || typeof row.volume_fingerprint === 'string' && HASH.test(row.volume_fingerprint))
      || typeof row.editable !== 'boolean' || row.editable && (row.size_bytes === null || row.volume_fingerprint === null || typeof row.pool !== 'string' || !row.pool)) throw new Error('Disk observation is incomplete.')
    return { id: row.id, size_bytes: row.size_bytes, pool: row.pool, volume_fingerprint: row.volume_fingerprint, editable: row.editable } as HardwareDisk
  })
  if (new Set(nics.map(row => row.id)).size !== nics.length || new Set(disks.map(row => row.id)).size !== disks.length) throw new Error('Duplicate hardware observation.')
  return { nics, disks }
}

export function validateHardwareReview(value: unknown, target: { host_id: string; node: string; vmid: number; target_digest?: string }): HardwareReview {
  if (typeof target.host_id !== 'string' || !target.host_id || typeof target.node !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(target.node)
    || !Number.isSafeInteger(target.vmid) || target.vmid < 100 || target.vmid > 999999999
    || !record(value) || value.vmtype !== 'qemu' || value.host_id !== target.host_id || value.node !== target.node || value.vmid !== target.vmid
    || typeof value.digest !== 'string' || !HASH.test(value.digest) || typeof value.target_digest !== 'string' || !HASH.test(value.target_digest)
    || target.target_digest !== undefined && value.target_digest !== target.target_digest || !Array.isArray(value.pending)
    || value.pending.length > 96 || value.pending.some(key => typeof key !== 'string' || !NIC.test(key) && !DISK.test(key))) throw new Error('Hardware review does not match the selected target.')
  return { host_id: target.host_id, node: target.node, vmid: target.vmid, vmtype: 'qemu', digest: value.digest, target_digest: value.target_digest,
    current: values(value.current), configured: values(value.configured), pending: [...value.pending] as string[] }
}

export function validateHardwareResult(value: unknown, target: HardwareReview): HardwareResult {
  if (!record(value) || !['configured', 'accepted', 'unconfirmed'].includes(String(value.status))) throw new Error('Hardware completion is unconfirmed.')
  const review = value.review === null ? null : validateHardwareReview(value.review, target)
  const parts = typeof value.upid === 'string' ? value.upid.split(':') : []
  const validTask = parts.length === 9 && parts[0] === 'UPID' && parts[1] === target.node && parts[6] === String(target.vmid)
    && ['qmconfig', 'resize'].includes(parts[5]) && parts.slice(2, 5).every(part => /^[A-Fa-f0-9]+$/.test(part))
    && !!parts[7] && !/\s/.test(parts[7]) && parts[8] === ''
  if (value.status === 'configured' && (!review || value.upid !== null)
    || value.status === 'accepted' && !validTask
    || value.upid !== null && typeof value.upid !== 'string') throw new Error('Hardware completion is unconfirmed.')
  return { status: value.status as HardwareResult['status'], upid: value.upid as string | null, review }
}

export function validateDiskGrowth(disk: string, size: number) {
  if (!DISK.test(disk) || !Number.isSafeInteger(size) || size < 1 || size > 65536) throw new Error('Choose an existing disk and an absolute size from 1 to 65536 GiB.')
}
export function validateNicId(id: string) { if (!NIC.test(id)) throw new Error('Choose an existing NIC.') }
