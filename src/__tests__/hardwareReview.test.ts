import { describe, expect, it } from 'vitest'
import { validateHardwareReview, validateHardwareResult, validateNicChanges } from '@/services/proxmox/hardwareReview'

const target = { host_id: 'host', node: 'pve-b', vmid: 60001 }
const review = () => ({ ...target, vmtype: 'qemu', digest: 'a'.repeat(64), target_digest: 'b'.repeat(64),
  current: { nics: [], disks: [] }, configured: { nics: [], disks: [] }, pending: [] })

describe('hardware response and intent boundaries', () => {
  it.each(['node', 'host_id', 'vmid'])('rejects a response for another %s', field => {
    expect(() => validateHardwareReview({ ...review(), [field]: 'other' }, target)).toThrow(/target/i)
  })
  it('rejects malformed local targets even when echoed by a response', () => {
    const bad = { ...target, vmid: -1 }
    expect(() => validateHardwareReview({ ...review(), ...bad }, bad)).toThrow(/target/i)
  })
  it.each(['UPID:pve-b:1:2:3:qmconfig:60002:user@pam:', 'UPID:pve-b:1:2:3:destroy:60001:user@pam:', 'UPID:pve-b:bad'])('rejects unrelated task %s', upid => {
    expect(() => validateHardwareResult({ status: 'accepted', upid, review: null }, validateHardwareReview(review(), target))).toThrow(/unconfirmed/i)
  })
  it.each([{ model: 'e1000' }, { mac: 'replacement' }, { firewall: 1 }, { bridge: '' }, { tag: 4095 }])('rejects unsupported or malformed NIC intent %j', changes => {
    expect(() => validateNicChanges(changes)).toThrow()
  })
})
