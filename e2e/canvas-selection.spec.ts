import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { routeApi } from './fixtures/routeApi'

const children = [
  { id: 'first', type: 'vm', position: { x: 80, y: 120 }, data: { config: { name: 'First server' } } },
  { id: 'second', type: 'vm', position: { x: 460, y: 120 }, data: { config: { name: 'Second server' } } },
]
async function setup(page: Page, grouped = false) {
  const api = await routeApi(page, [{ id: 'selection', name: 'Canvas selection', nodes: [
    ...(grouped ? [{ id: 'group', type: 'group', position: { x: 0, y: 0 },
      style: { width: '900px', height: '600px' }, data: { hasChildren: true, config: { name: 'Servers' } } }] : []),
    ...children.map(node => ({ ...node, ...(grouped ? { parentNode: 'group', extent: 'parent' } : {}) })),
    { id: 'outside', type: 'network-segment', position: { x: 1050, y: 600 }, data: { config: { name: 'Outside network', bridge: 'vmbr10' } } },
  ], edges: [{ id: 'link', type: 'network', source: 'first', target: 'outside' }] }])
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto('/project/selection')
  await expect(page.locator('.vue-flow__node')).toHaveCount(grouped ? 4 : 3)
  await expect(page.locator('.vue-flow__transformationpane')).toHaveCSS('opacity', '1')
  return api
}
async function geometry(page: Page) {
  return page.locator('.vue-flow__node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const transform = new DOMMatrix(getComputedStyle(node).transform)
    return [(node as HTMLElement).dataset.id, { x: transform.m41, y: transform.m42 }]
  })))
}
async function selectBox(page: Page, ids: string[], reverse = false) {
  const boxes = await Promise.all(ids.map(id => page.locator(`.vue-flow__node[data-id="${id}"]`).boundingBox()))
  const bounds = { left: Math.min(...boxes.map(b => b!.x)) - 12, top: Math.min(...boxes.map(b => b!.y)) - 12,
    right: Math.max(...boxes.map(b => b!.x + b!.width)) + 12, bottom: Math.max(...boxes.map(b => b!.y + b!.height)) + 12 }
  await page.mouse.move(reverse ? bounds.right : bounds.left, reverse ? bounds.bottom : bounds.top)
  await page.mouse.down()
  await page.mouse.move(reverse ? bounds.left : bounds.right, reverse ? bounds.top : bounds.bottom, { steps: 12 })
  await expect(page.locator('.vue-flow__selection')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.vue-flow__node.selected')).toHaveCount(ids.length)
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function moveSelection(page: Page) {
  const box = await page.locator('.vue-flow__nodesselection-rect').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2 + 80, { steps: 12 })
  await page.mouse.up()
}

test('left-drag selects nodes, moves them together and undoes the entire move in one step', async ({ page }) => {
  const api = await setup(page)
  const before = await geometry(page)
  const viewport = await page.locator('.vue-flow__transformationpane').getAttribute('style')
  await selectBox(page, ['first', 'second'])
  expect(await page.locator('.vue-flow__transformationpane').getAttribute('style')).toBe(viewport)
  await expect(page.getByTestId('canvas-selection-status')).toContainText('2 selected')
  await page.screenshot({ path: '/tmp/r42-canvas-selection-light.png', animations: 'disabled' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: '/tmp/r42-canvas-selection-dark.png', animations: 'disabled' })
  const accessibility = await new AxeBuilder({ page }).include('[data-testid="canvas-wrapper"]')
    .withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(accessibility.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }))).toEqual([])
  await moveSelection(page)
  const moved = await geometry(page)
  expect(moved.first.x).toBeGreaterThan(before.first.x)
  expect(moved.first.y).toBeGreaterThan(before.first.y)
  expect(moved.second.x - before.second.x).toBe(moved.first.x - before.first.x)
  expect(moved.second.y - before.second.y).toBe(moved.first.y - before.first.y)
  expect(moved.outside).toEqual(before.outside)
  await expect(page.locator('.vue-flow__edge')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => geometry(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(() => geometry(page)).toEqual(moved)
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  await page.reload()
  await expect.poll(() => geometry(page)).toEqual(moved)
  expect(api.state.writes).toEqual([])
})

test('selecting children inside a group leaves the group and unselected nodes in place', async ({ page }) => {
  await setup(page, true)
  const before = await geometry(page)
  await selectBox(page, ['first', 'second'], true)
  await expect(page.locator('.vue-flow__node[data-id="group"]')).not.toHaveClass(/selected/)
  await moveSelection(page)
  const moved = await geometry(page)
  expect(moved.first.x).toBeGreaterThan(before.first.x)
  expect(moved.second.x - before.second.x).toBe(moved.first.x - before.first.x)
  expect(moved.second.y - before.second.y).toBe(moved.first.y - before.first.y)
  expect(moved.group).toEqual(before.group)
  expect(moved.outside).toEqual(before.outside)
})

test('selecting a group and its children moves the children once and preserves their parent', async ({ page }) => {
  await setup(page, true)
  const before = await geometry(page)
  await selectBox(page, ['group', 'first', 'second'])
  await moveSelection(page)
  const moved = await geometry(page)
  expect(moved.group.x).toBeGreaterThan(before.group.x)
  for (const id of ['first', 'second']) {
    expect(moved[id].x - before[id].x).toBe(moved.group.x - before.group.x)
    expect(moved[id].y - before[id].y).toBe(moved.group.y - before.group.y)
  }
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects')!)[0])
  for (const node of children) expect(saved.nodes.find((n: { id: string }) => n.id === node.id))
    .toMatchObject({ parentNode: 'group', position: node.position })
})

test('right-drag, Space-drag and Pan mode pan without moving nodes', async ({ page }) => {
  await setup(page)
  const before = await geometry(page)
  const pane = page.locator('.vue-flow__transformationpane')
  const canvas = page.getByTestId('canvas-wrapper')
  const box = await canvas.boundingBox()
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height - 140 }
  for (const method of ['right', 'space', 'pan'] as const) {
    if (method === 'space') { await canvas.focus(); await page.keyboard.down('Space') }
    if (method === 'pan') await page.getByRole('button', { name: 'Pan canvas', exact: true }).click()
    const viewport = await pane.getAttribute('style')
    await page.mouse.move(start.x, start.y)
    await page.mouse.down({ button: method === 'right' ? 'right' : 'left' })
    await page.mouse.move(start.x + 50, start.y - 50, { steps: 8 })
    await page.mouse.up({ button: method === 'right' ? 'right' : 'left' })
    if (method === 'space') await page.keyboard.up('Space')
    await expect.poll(() => pane.getAttribute('style')).not.toBe(viewport)
    expect(await geometry(page)).toEqual(before)
    await expect(page.locator('.vue-flow__node.selected')).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Select nodes', exact: true }).click()
  await page.getByRole('button', { name: 'Fit view', exact: true }).click()
  await selectBox(page, ['first', 'second'])
  await page.keyboard.press('Escape')
  await expect(page.locator('.vue-flow__node.selected')).toHaveCount(0)
  await expect(page.locator('.vue-flow__nodesselection-rect')).toHaveCount(0)
})
