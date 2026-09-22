import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { routeApi } from './fixtures/routeApi'

const longName = 'workshop-production-application-server-with-a-very-long-name'
const project = { id: 'presentation', name: 'Canvas presentation', nodes: [
  { id: 'vm', type: 'vm', position: { x: 100, y: 100 }, data: { tags: ['student', 'ctf', 'gateway'], config: { name: longName, cores: 4, memory: 4096 } } },
  { id: 'lxc', type: 'lxc', position: { x: 500, y: 100 }, data: { tags: ['admin', 'monitoring'], config: { name: 'Monitoring', cpu: 2, memory: 2048, template: 'debian-12' } } },
  { id: 'docker', type: 'docker', position: { x: 900, y: 100 }, data: { host_ref: 'vm', config: { name: 'Application', image: 'registry.example.org/team/application:latest', ports: ['8080:80'] } } },
  ...['wan', 'lan', 'dmz', 'management', 'custom'].map((segmentType, index) => ({
    id: segmentType, type: 'network-segment', position: { x: 100 + index * 350, y: 440 },
    data: { config: { name: `${segmentType.toUpperCase()} network`, segmentType, bridge: 'vmbr20', cidr: `10.10.${index}.0/24`, gateway: `10.10.${index}.1` } },
  })),
  { id: 'router', type: 'router', position: { x: 1300, y: 100 }, data: { config: { name: 'Gateway', routingProtocol: 'static', routerId: '10.0.0.1' } } },
  { id: 'fw', type: 'edge-firewall', position: { x: 1650, y: 100 }, data: { config: { name: 'Firewall', applianceType: 'pfsense', wanIp: '10.0.0.2', lanIp: '10.1.0.1', dmzIp: '10.2.0.1' } } },
  { id: 'group', type: 'group', position: { x: 100, y: 800 }, style: { width: '640px', height: '250px' }, data: { kind: 'team_scope', team_count: 3, config: { name: longName, description: 'Training environment' } } },
  { id: 'note', type: 'note', position: { x: 900, y: 800 }, style: { width: '320px', height: '200px' }, data: { config: { name: 'Operations note', text: 'Check the network before deploying.', color: 'blue' } } },
], edges: [
  { id: 'vm-lan', type: 'network', source: 'vm', target: 'lan', data: { connection: { interfaceName: 'net0', ipAddress: '10.10.1.10/24', vlanTag: 20 } } },
  { id: 'lxc-dmz', type: 'network', source: 'lxc', target: 'dmz', data: { connection: { interfaceName: 'net0' } } },
] }

async function openCanvas(page: Page) {
  await routeApi(page, [project])
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto('/project/presentation')
  await expect(page.locator('.network-segment-node')).toHaveCount(5)
  await expect(page.locator('.edge-label')).toHaveCount(2)
}

for (const [theme, system] of [['system', 'light'], ['system', 'dark'], ['light', 'dark'], ['dark', 'light']] as const) {
  test(`canvas text has AA contrast with ${theme} theme and ${system} system`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system })
    await page.addInitScript(theme => localStorage.setItem('range42_ui_preferences', JSON.stringify({ theme })), theme)
    await openCanvas(page)
    const results = await new AxeBuilder({ page }).include('[data-testid="canvas-wrapper"]')
      .withRules(['color-contrast']).analyze()
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([])
    await page.screenshot({ path: `/tmp/r42-canvas-${theme}-${system}.png` })
  })
}

test('arrow navigation visibly selects a node without stealing Enter from zoom controls', async ({ page }) => {
  await openCanvas(page)
  const canvas = page.getByTestId('canvas-wrapper')
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.vue-flow__node[data-id="vm"]')).toHaveClass(/selected/)
  const viewport = page.locator('.vue-flow__transformationpane')
  const before = await viewport.getAttribute('style')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(before)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await canvas.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^Name/ })).toHaveValue(longName)
})

test('node names remain contained and connection labels have opaque surfaces', async ({ page }) => {
  await openCanvas(page)
  const widths = await page.locator('.vue-flow__node').evaluateAll(nodes => nodes.map(node => ({
    id: (node as HTMLElement).dataset.id, width: node.getBoundingClientRect().width,
    zoom: Number((document.querySelector('.vue-flow__transformationpane') as HTMLElement).style.transform.match(/scale\(([^)]+)/)?.[1]),
  })))
  for (const node of widths.filter(n => ['vm', 'docker'].includes(n.id!))) {
    expect(node.width / node.zoom, `${node.id} width with long content`).toBeLessThanOrEqual(320)
  }
  const alpha = await page.locator('.edge-label').evaluateAll(labels => labels.map(label => {
    const context = document.createElement('canvas').getContext('2d')!
    context.fillStyle = getComputedStyle(label).backgroundColor
    context.fillRect(0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data[3]
  }))
  expect(alpha).toEqual([255, 255])
})

test('connection inspector labels its fields, accepts keyboard input and returns focus on Escape', async ({ page }) => {
  await openCanvas(page)
  const edit = page.getByRole('button', { name: 'Edit connection', exact: true }).first()
  await edit.focus()
  await page.keyboard.press('Enter')
  const inspector = page.locator('.edge-config-panel')
  await expect(inspector).toBeVisible()
  await expect(inspector).toBeFocused()
  await inspector.getByRole('textbox', { name: 'Interface Name', exact: true }).fill('eth1')
  await expect(page.locator('.edge-label').first()).toContainText('eth1')
  const results = await new AxeBuilder({ page }).include('.edge-config-panel').withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
  await page.keyboard.press('Escape')
  await expect(inspector).toHaveCount(0)
  await expect(edit).toBeFocused()
})

test('node dialog keeps Tab focus inside and restores focus when closed', async ({ page }) => {
  await openCanvas(page)
  const canvas = page.getByTestId('canvas-wrapper')
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([])
  await dialog.getByRole('button', { name: 'Save Configuration', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(canvas).toBeFocused()
})

test('canvas controls and connection inspector fit a narrow screen', async ({ page }) => {
  await openCanvas(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Fit view', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Fit view', exact: true }).click()
  await page.getByRole('button', { name: 'Edit connection', exact: true }).first().click()
  const inspector = page.locator('.edge-config-panel')
  await expect(inspector).toBeVisible()
  const box = await inspector.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.y + box!.height).toBeLessThanOrEqual(844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '/tmp/r42-canvas-mobile-inspector.png' })
})

test('runtime states and metrics keep readable text in both themes', async ({ page }) => {
  await routeApi(page, [{ id: 'runtime-colors', name: 'Runtime status', nodes: [
    ...['running', 'paused', 'error', 'deploying'].map((status, index) => ({
      id: status, type: 'vm', position: { x: 100 + index * 320, y: 100 },
      data: { deployed: true, status, liveMetrics: { cpu: 23, memPercent: 51 }, config: { name: `${status} device`, vmid: 100 + index } },
    })),
    { id: 'container', type: 'lxc', position: { x: 100, y: 400 }, data: { status: 'running', liveMetrics: { cpu: 18, memPercent: 45 }, config: { name: 'Container', unprivileged: true } } },
    { id: 'workload', type: 'docker', position: { x: 450, y: 400 }, data: { status: 'running', config: { name: 'Unbound workload' } } },
  ], edges: [] }])
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/project/runtime-colors')
  await expect(page.locator('.infra-node')).toHaveCount(6)
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const results = await new AxeBuilder({ page }).include('[data-testid="canvas-wrapper"]')
      .withRules(['color-contrast']).analyze()
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([])
  }
})
