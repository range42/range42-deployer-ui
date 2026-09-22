import { expect, test, type Page } from '@playwright/test'
import { routeApi } from './fixtures/routeApi'

const project = { id: 'layout', name: 'Example topology', nodes: [
  { id: 'site', type: 'group', position: { x: 100, y: 100 },
    style: { width: '900px', height: '850px' }, data: { hasChildren: true, config: { name: 'Site' } } },
  { id: 'services', type: 'group', parentNode: 'site', extent: 'parent', position: { x: 60, y: 250 },
    style: { width: '700px', height: '500px' }, data: { hasChildren: true, config: { name: 'Services' } } },
  { id: 'gateway', type: 'vm', parentNode: 'site', extent: 'parent', position: { x: 60, y: 100 },
    data: { config: { name: 'Gateway' } } },
  { id: 'server', type: 'vm', parentNode: 'services', extent: 'parent', position: { x: 50, y: 100 },
    data: { config: { name: 'Server' } } },
  { id: 'lan', type: 'network-segment', parentNode: 'services', extent: 'parent',
    position: { x: 50, y: 100 }, data: { config: { name: 'Services LAN', segmentType: 'lan',
      cidr: '10.10.20.0/24', bridge: 'vmbr20', vlan: 20, gateway: '10.10.20.1' } } },
  { id: 'wan', type: 'network-segment', position: { x: 1100, y: 100 },
    data: { config: { name: 'Uplink', segmentType: 'wan', bridge: 'vmbr10', cidr: '10.10.0.0/24' } } },
], edges: [
  { id: 'uplink', type: 'network', source: 'gateway', target: 'wan', label: 'Uplink' },
  { id: 'downlink', type: 'network', source: 'gateway', target: 'lan' },
  { id: 'server-link', type: 'network', source: 'server', target: 'lan' },
  { id: 'second-nic', type: 'network', source: 'server', target: 'lan' },
] }

async function geometry(page: Page) {
  return page.locator('.vue-flow__node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const element = node as HTMLElement
    return [element.dataset.id, { transform: element.style.transform,
      width: element.style.width, height: element.style.height }]
  })))
}

async function expectBackgroundOrder(page: Page) {
  await expect.poll(() => page.locator('[data-background-id] rect').evaluateAll(rects => {
    const areas = rects.map(rect => Number(rect.getAttribute('width')) * Number(rect.getAttribute('height')))
    return areas.length === 4 && areas.every((area, index) => index === 0 || areas[index - 1] >= area)
  })).toBe(true)
}

test('organizes nested groups, undoes once and keeps backgrounds ordered by area', async ({ page }) => {
  const api = await routeApi(page, [project])
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto('/project/layout')
  await expect(page.locator('.network-segment-node').filter({ hasText: 'Services LAN' }))
    .toContainText('2 devices connected', { timeout: 15000 })
  await expectBackgroundOrder(page)
  const before = await geometry(page)
  await page.getByRole('button', { name: 'Organize topology layout', exact: true }).click()
  await expect.poll(async () => JSON.stringify(await geometry(page))).not.toBe(JSON.stringify(before))
  // Every child must fit inside its actual rendered parent after layout.
  for (const [childId, parentId] of [['services', 'site'], ['gateway', 'site'], ['server', 'services'], ['lan', 'services']]) {
    await expect.poll(async () => {
      const child = await page.locator(`.vue-flow__node[data-id="${childId}"]`).boundingBox()
      const parent = await page.locator(`.vue-flow__node[data-id="${parentId}"]`).boundingBox()
      return !!child && !!parent && child.x > parent.x && child.y > parent.y
        && child.x + child.width < parent.x + parent.width && child.y + child.height < parent.y + parent.height
    }).toBe(true)
  }
  await expect.poll(async () => {
    const server = await page.locator('.vue-flow__node[data-id="server"]').boundingBox()
    const lan = await page.locator('.vue-flow__node[data-id="lan"]').boundingBox()
    return !!server && !!lan && server.y > lan.y + lan.height
  }).toBe(true)
  const arranged = await geometry(page)
  await expectBackgroundOrder(page)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => geometry(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(() => geometry(page)).toEqual(arranged)
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  await page.reload()
  await expect.poll(() => geometry(page)).toEqual(arranged)
  await expectBackgroundOrder(page)
  await page.screenshot({ path: '/tmp/r42-canvas-layout-light.png' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: '/tmp/r42-canvas-layout-dark.png' })
  expect(api.state.writes).toEqual([])
})

test('resizes group backgrounds and draws a device connection from a network port', async ({ page }) => {
  const api = await routeApi(page, [{ id: 'ports', name: 'Example ports', nodes: [
    { id: 'group', type: 'group', position: { x: 100, y: 100 },
      style: { width: '450px', height: '350px' }, data: { hasChildren: true, config: { name: 'Devices' } } },
    { id: 'first', type: 'vm', parentNode: 'group', extent: 'parent', position: { x: 50, y: 150 },
      data: { config: { name: 'First device' } } },
    { id: 'second', type: 'vm', position: { x: 700, y: 500 }, data: { config: { name: 'Second device' } } },
    { id: 'net', type: 'network-segment', position: { x: 650, y: 100 },
      data: { config: { name: 'Network', segmentType: 'wan', bridge: 'vmbr10' } } },
  ], edges: [{ id: 'existing', type: 'network', source: 'first', target: 'net' }] }])
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto('/project/ports')
  const order = () => page.locator('[data-background-id]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-background-id')))
  await expect.poll(order, { timeout: 15000 }).toEqual(['net', 'group'])
  const group = page.locator('.vue-flow__node[data-id="group"]')
  await group.locator('.group-header').click({ position: { x: 80, y: 20 } })
  await page.getByRole('button', { name: 'Close configuration panel', exact: true }).click()
  const handle = await group.locator('.vue-flow__resize-control.bottom.right.handle').boundingBox()
  expect(handle).not.toBeNull()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle!.x + 350, handle!.y + 180, { steps: 10 })
  await page.mouse.up()
  await expect.poll(order).toEqual(['group', 'net'])
  const source = await page.locator('.vue-flow__node[data-id="net"] [data-handleid="out-bottom"]').boundingBox()
  const target = await page.locator('.vue-flow__node[data-id="second"] .vue-flow__handle.target').boundingBox()
  expect(source).not.toBeNull()
  expect(target).not.toBeNull()
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2)
  await page.mouse.down()
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('.network-segment-node')).toContainText('2 devices connected')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const added = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects')!)[0].edges
    .find((edge: { source: string; target: string }) => edge.source === 'net' && edge.target === 'second'))
  expect(added.data.connection.interfaceName).toBe('net0')
  expect(api.state.writes).toEqual([])
})
