import { describe, it, expect } from 'vitest'
import { parseNetworkInterfaces } from '@/composables/useInfrastructureImport'

describe('parseNetworkInterfaces', () => {
  it('derives bridge, ip, cidr network and gateway from net0 + ipconfig0', () => {
    const ifaces = parseNetworkInterfaces({
      net0: 'virtio=BC:24:11:29:B7:88,bridge=vmbr142,firewall=1',
      ipconfig0: 'ip=192.168.142.123/24,gw=192.168.142.1',
    })
    expect(ifaces).toHaveLength(1)
    expect(ifaces[0]).toMatchObject({
      name: 'net0',
      bridge: 'vmbr142',
      ip: '192.168.142.123',
      cidr: '192.168.142.0/24',
      gateway: '192.168.142.1',
      firewall: true,
    })
  })

  it('computes the network address for a non-/24 prefix', () => {
    const ifaces = parseNetworkInterfaces({
      net0: 'virtio=AA:BB,bridge=vmbr10',
      ipconfig0: 'ip=10.20.30.40/16,gw=10.20.0.1',
    })
    expect(ifaces[0].cidr).toBe('10.20.0.0/16')
    expect(ifaces[0].gateway).toBe('10.20.0.1')
  })

  it('returns the NIC without cidr/gateway when there is no ipconfig (dhcp/unknown)', () => {
    const ifaces = parseNetworkInterfaces({ net0: 'virtio=AA,bridge=vmbr0' })
    expect(ifaces[0]).toMatchObject({ name: 'net0', bridge: 'vmbr0' })
    expect(ifaces[0].cidr).toBeUndefined()
    expect(ifaces[0].gateway).toBeUndefined()
  })

  it('parses LXC inline ip/gw from netN (no ipconfig)', () => {
    const ifaces = parseNetworkInterfaces({
      net0: 'name=eth0,bridge=vmbr142,hwaddr=AA:BB:CC:DD:EE:FF,ip=192.168.142.50/24,gw=192.168.142.1,type=veth',
    })
    expect(ifaces).toHaveLength(1)
    expect(ifaces[0]).toMatchObject({
      name: 'net0',
      bridge: 'vmbr142',
      ip: '192.168.142.50',
      cidr: '192.168.142.0/24',
      gateway: '192.168.142.1',
    })
  })

  it('treats ip=dhcp (LXC) as dhcp with no cidr', () => {
    const ifaces = parseNetworkInterfaces({ net0: 'name=eth0,bridge=vmbr0,ip=dhcp' })
    expect(ifaces[0].bridge).toBe('vmbr0')
    expect(ifaces[0].ip).toBeUndefined()
    expect(ifaces[0].cidr).toBeUndefined()
  })

  it('skips NICs without a bridge and handles multiple interfaces', () => {
    const ifaces = parseNetworkInterfaces({
      net0: 'virtio=AA,bridge=vmbr142',
      net1: 'virtio=BB,bridge=vmbr140',
      ipconfig1: 'ip=10.140.0.5/24,gw=10.140.0.1',
    })
    expect(ifaces.map((i) => i.bridge)).toEqual(['vmbr142', 'vmbr140'])
    expect(ifaces[1].cidr).toBe('10.140.0.0/24')
  })
})
