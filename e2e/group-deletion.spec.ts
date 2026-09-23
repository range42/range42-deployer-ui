import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { routeApi } from './fixtures/routeApi'

const project = { id: 'group-delete', name: 'Group deletion', nodes: [
  { id: 'group', type: 'group', position: { x: 100, y: 100 }, style: { width: '900px', height: '700px' }, data: { hasChildren: true, config: { name: 'Lab group' } } },
  { id: 'vm', type: 'vm', parentNode: 'group', extent: 'parent', expandParent: true, position: { x: 60, y: 100 }, data: { config: { name: 'Retained VM' } } },
  { id: 'nested', type: 'group', parentNode: 'group', extent: 'parent', position: { x: 80, y: 270 }, style: { width: '550px', height: '340px' }, data: { hasChildren: true, config: { name: 'Nested group' } } },
  { id: 'lxc', type: 'lxc', parentNode: 'nested', extent: 'parent', position: { x: 80, y: 120 }, data: { config: { name: 'Retained container' } } },
  { id: 'network', type: 'network-segment', position: { x: 1200, y: 100 }, data: { config: { name: 'Outside network', bridge: 'vmbr10', segmentType: 'lan' } } },
], edges: [
  { id: 'vm-network', type: 'network', source: 'vm', target: 'network' },
  { id: 'lxc-network', type: 'network', source: 'lxc', target: 'network' },
] }

async function setup(page: Page) {
  const api = await routeApi(page, [project])
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto('/project/group-delete')
  await expect(page.locator('.vue-flow__node')).toHaveCount(5)
  return api
}
async function requestDelete(page: Page, id = 'group') {
  await page.locator(`.vue-flow__node[data-id="${id}"] .group-header`).click()
  await page.getByRole('button', { name: 'Delete node', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete group', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
async function positions(page: Page) {
  return page.locator('.vue-flow__node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const box = node.getBoundingClientRect()
    return [(node as HTMLElement).dataset.id, { x: box.x, y: box.y }]
  })))
}

test('group-only removal preserves descendants, positions and connections through undo and reload', async ({ page }) => {
  const api = await setup(page)
  const before = await positions(page)
  const dialog = await requestDelete(page)
  await expect(dialog).toContainText('Lab group')
  await expect(dialog).toContainText('3')
  await dialog.getByRole('button', { name: 'Remove group only', exact: true }).click()
  await expect(page.locator('.vue-flow__node')).toHaveCount(4)
  const after = await positions(page)
  for (const id of ['vm', 'nested', 'lxc', 'network']) {
    expect(after[id].x).toBeCloseTo(before[id].x, 0)
    expect(after[id].y, JSON.stringify({ id, before, after })).toBeCloseTo(before[id].y, 0)
  }
  await expect(page.locator('.vue-flow__edge')).toHaveCount(2)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.vue-flow__node')).toHaveCount(5)
  const undone = await positions(page)
  for (const id of ['vm', 'nested', 'lxc', 'network']) {
    expect(undone[id].x).toBeCloseTo(before[id].x, 0)
    expect(undone[id].y).toBeCloseTo(before[id].y, 0)
  }
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.locator('.vue-flow__node')).toHaveCount(4)
  const redone = await positions(page)
  for (const id of ['vm', 'nested', 'lxc', 'network']) {
    expect(redone[id].x).toBeCloseTo(before[id].x, 0)
    expect(redone[id].y).toBeCloseTo(before[id].y, 0)
  }
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects')!)[0])
  expect(saved.nodes.find((n: { id: string }) => n.id === 'vm')).toMatchObject({ position: { x: 160, y: 200 } })
  expect(saved.nodes.find((n: { id: string }) => n.id === 'vm').parentNode).toBeUndefined()
  expect(saved.nodes.find((n: { id: string }) => n.id === 'vm').extent).toBeUndefined()
  expect(saved.nodes.find((n: { id: string }) => n.id === 'nested')).toMatchObject({ position: { x: 180, y: 370 } })
  expect(saved.nodes.find((n: { id: string }) => n.id === 'lxc').parentNode).toBe('nested')
  await page.reload()
  await expect(page.locator('.vue-flow__node')).toHaveCount(4)
  await expect(page.locator('.vue-flow__edge')).toHaveCount(2)
  expect(api.state.writes).toEqual([])
})

test('recursive deletion is explicit, removes nested contents and connections, and undoes in one step', async ({ page }) => {
  const api = await setup(page)
  const dialog = await requestDelete(page)
  await dialog.getByRole('button', { name: 'Remove group and contents', exact: true }).click()
  await expect(page.locator('.vue-flow__node')).toHaveCount(1)
  await expect(page.locator('.vue-flow__node[data-id="network"]')).toBeVisible()
  await expect(page.locator('.vue-flow__edge')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.vue-flow__node')).toHaveCount(5)
  await expect(page.locator('.vue-flow__edge')).toHaveCount(2)
  expect(api.state.writes).toEqual([])
})

test('removing a nested group moves its children into the surviving outer group', async ({ page }) => {
  await setup(page)
  const before = await positions(page)
  const dialog = await requestDelete(page, 'nested')
  await dialog.getByRole('button', { name: 'Remove group only', exact: true }).click()
  await expect(page.locator('.vue-flow__node')).toHaveCount(4)
  const after = await positions(page)
  expect(after.lxc.x).toBeCloseTo(before.lxc.x, 0)
  expect(after.lxc.y).toBeCloseTo(before.lxc.y, 0)
  await expect(page.locator('.vue-flow__edge')).toHaveCount(2)
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects')!)[0])
  expect(saved.nodes.find((n: { id: string }) => n.id === 'lxc')).toMatchObject({
    parentNode: 'group', position: { x: 160, y: 390 }, extent: 'parent',
  })
})

test('Backspace asks before removing a group and Cancel keeps its entire contents', async ({ page }) => {
  const api = await setup(page)
  await page.locator('.vue-flow__node[data-id="group"] .group-header').click()
  await page.getByRole('button', { name: 'Close configuration panel', exact: true }).click()
  await page.getByTestId('canvas-wrapper').focus()
  await page.keyboard.press('Backspace')
  const dialog = page.getByRole('dialog', { name: 'Delete group', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await expect(page.locator('.vue-flow__node')).toHaveCount(5)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.vue-flow__node')).toHaveCount(5)
  expect(api.state.writes).toEqual([])
})

test('group deletion dialog fits a narrow screen, has readable contrast and traps keyboard focus', async ({ page }) => {
  await setup(page)
  const dialog = await requestDelete(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const box = await dialog.locator('.modal-box').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  const results = await new AxeBuilder({ page }).include('[aria-labelledby="delete-node-title"]')
    .withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }))).toEqual([])
  await page.screenshot({ path: '/tmp/r42-group-delete-mobile.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.vue-flow__node')).toHaveCount(5)
})
