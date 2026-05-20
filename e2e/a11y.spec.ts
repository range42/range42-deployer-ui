/**
 * Plan C §C6.6 — axe-core a11y zero-violation floor.
 *
 * For each of three routes (`/project/:id`, `/deployments/:id`, `/catalog`)
 * seed the minimum state needed to render, run axe against `wcag2a`, and
 * assert zero violations. A fourth test covers the canvas keyboard-trap
 * escape: focus the canvas wrapper, press Tab several times, confirm focus
 * leaves the canvas (no focus-trap lock).
 *
 * These tests run against the Playwright-managed dev server defined in
 * `playwright.config.ts`; no live backend is required because `setupMockApi`
 * intercepts every `/v1/*` fetch.
 */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi, seedLocalStorage } from './fixtures/mockApi'

test.describe.configure({ mode: 'serial' })

const BASE_SOURCES = [
  {
    id: 'gitlab:range42/catalog',
    provider: 'gitlab',
    base_url: 'https://gitlab.example',
    auth: { kind: 'none' },
  },
]

const BASE_PROXMOX = {
  hosts: [{ id: 'pve-mock-01', name: 'pve-mock-01', node_name: 'pve-mock-01' }],
  baseUrl: 'http://mock-backend/v0',
}

async function runAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a']).analyze()
  return results.violations
}

test('a11y: /project/:id has zero wcag2a violations', async ({ page }) => {
  const PROJECT_ID = 'project_e2e_a11y_1'

  await seedLocalStorage(page, {
    migrationDone: true,
    sources: BASE_SOURCES,
    proxmoxSettings: BASE_PROXMOX,
    projects: [
      {
        id: PROJECT_ID,
        name: 'A11y Project',
        created: '2026-04-14T09:00:00Z',
        modified: '2026-04-14T09:00:00Z',
        nodes: [],
        edges: [],
        gamenet: false,
      },
    ],
  })

  await setupMockApi(page)

  await page.goto(`/project/${PROJECT_ID}`)
  await expect(page.getByTestId('canvas-wrapper')).toBeVisible({ timeout: 10_000 })

  const violations = await runAxe(page)
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
})

test('a11y: /deployments/:id has zero wcag2a violations', async ({ page }) => {
  const DEPLOYMENT_ID = 'dep-e2e-a11y'

  await seedLocalStorage(page, {
    migrationDone: true,
    sources: BASE_SOURCES,
    proxmoxSettings: BASE_PROXMOX,
  })

  const mock = await setupMockApi(page)
  mock.state.deployments.set(DEPLOYMENT_ID, {
    id: DEPLOYMENT_ID,
    codename: 'a11y-codename',
    scenario_label: 'demo_lab',
    state: 'deployed',
    team_count: 1,
    attempts: [{ attempt_id: 'a-1', state: 'deployed', started_at: '2026-04-14T10:00:00Z' }],
  })

  await page.goto(`/deployments/${DEPLOYMENT_ID}`)
  await expect(page.getByTestId('detail-state')).toBeVisible({ timeout: 10_000 })

  const violations = await runAxe(page)
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
})

test('a11y: /catalog has zero wcag2a violations', async ({ page }) => {
  await seedLocalStorage(page, {
    migrationDone: true,
    sources: BASE_SOURCES,
    proxmoxSettings: BASE_PROXMOX,
  })

  await setupMockApi(page)

  await page.goto('/catalog')
  // Either the grid renders (entries seeded) or the empty state — either is
  // a valid layout to evaluate. Wait for filters to confirm view mounted.
  await expect(page.getByTestId('catalog-filters')).toBeVisible({ timeout: 10_000 })

  const violations = await runAxe(page)
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
})

test('a11y: canvas does not trap Tab focus', async ({ page }) => {
  const PROJECT_ID = 'project_e2e_a11y_trap'

  await seedLocalStorage(page, {
    migrationDone: true,
    sources: BASE_SOURCES,
    proxmoxSettings: BASE_PROXMOX,
    projects: [
      {
        id: PROJECT_ID,
        name: 'A11y Trap Project',
        created: '2026-04-14T09:00:00Z',
        modified: '2026-04-14T09:00:00Z',
        nodes: [],
        edges: [],
        gamenet: false,
      },
    ],
  })

  await setupMockApi(page)

  await page.goto(`/project/${PROJECT_ID}`)
  const canvas = page.getByTestId('canvas-wrapper')
  await expect(canvas).toBeVisible({ timeout: 10_000 })

  // Focus the canvas wrapper explicitly, then Tab repeatedly. After a small
  // number of Tabs the active element should have moved outside the canvas
  // subtree. If it stays inside for every press, we have a keyboard trap.
  await canvas.focus().catch(() => { /* may not be focusable; we rely on Tab */ })
  await page.keyboard.press('Tab')

  let escaped = false
  for (let i = 0; i < 20; i += 1) {
    const insideCanvas = await page.evaluate(() => {
      const el = document.activeElement
      if (!el) return false
      const wrapper = document.querySelector('[data-testid="canvas-wrapper"]')
      return wrapper ? wrapper.contains(el) : false
    })
    if (!insideCanvas) {
      escaped = true
      break
    }
    await page.keyboard.press('Tab')
  }

  expect(escaped, 'focus should escape the canvas wrapper within 20 Tab presses').toBe(true)
})
