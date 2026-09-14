import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { routeApi, routeEntryUrl, routeProject } from './fixtures/routeApi'

for (const width of [1440, 390]) {
  test(`nine routes render and reload without mutation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const api = await routeApi(page)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const routes = [
      ['/', '[data-testid="open-project-from-git"]'],
      ['/sources', '[data-testid="sources-list"]'],
      ['/catalog', '[data-testid="catalog-grid"]'],
      [routeEntryUrl, '[data-testid="entry-verbs"]'],
      ['/project/route-project', '[data-testid="canvas-wrapper"]'],
      ['/deployments', '[data-testid="deployments-root"]'],
      ['/deployments/route-deployment', '[data-testid="detail-state"]'],
      ['/deployments/route-deployment/preflight', '[data-testid="preflight-report"]'],
      ['/settings', '[data-testid="settings-snapshot-retention"]'],
    ]
    for (const [path, selector] of routes) {
      await test.step(path, async () => {
        await page.goto(path)
        await expect(page.locator(selector)).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
        expect(await page.evaluate(() => {
          const main = document.querySelector('main')!
          return document.documentElement.scrollWidth <= innerWidth && main.scrollWidth <= main.clientWidth + 1
        }), `${path} should fit ${width}px`).toBe(true)
      })
    }
    await page.goto('/project/route-project?tab=config')
    await expect(page.getByTestId('file-tree-list')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('file-tree-list')).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]')[0].files)).toEqual(routeProject.files)
    expect(api.state.writes).toEqual([])
    expect(api.state.unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('deployment loading, empty, terminal filtering and keyboard navigation are explicit', async ({ page }) => {
  const api = await routeApi(page)
  const release = api.hold('/v1/deployments')
  api.state.deployments = []
  await page.goto('/deployments')
  await expect(page.getByRole('status').filter({ hasText: /Loading/ })).toBeVisible()
  await expect(page.getByText('No deployments yet. Launch one from a project.')).toHaveCount(0)
  release()
  await expect(page.getByText('No deployments yet. Launch one from a project.')).toBeVisible()
  api.state.deployments = ['pending', 'partial', 'unknown'].map(state => ({ id: `dep-${state}`, codename: state,
    state, scenario_label: 'lab', project_id: 'backend-project', project_sha: 'b'.repeat(40), attempts_count: 0 }))
  await page.reload()
  await expect(page.getByTestId('deployments-active').getByTestId('deployment-row')).toHaveCount(1)
  await expect(page.getByTestId('deployments-past').getByTestId('deployment-row')).toHaveCount(2)
  await page.getByRole('button', { name: 'In-progress only', exact: true }).click()
  await expect(page.getByTestId('deployment-row')).toHaveCount(1)
  expect((await new AxeBuilder({ page }).include('[data-testid="deployments-root"]').withRules(['nested-interactive']).analyze()).violations).toEqual([])
  const row = page.getByTestId('deployment-row')
  await expect(row).toHaveAttribute('href', '/deployments/dep-pending')
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/deployments\/dep-pending$/)
  expect(api.state.writes).toEqual([])
})

test('cached catalog entries keep a visible expired-auth warning and retry', async ({ page }) => {
  const api = await routeApi(page)
  await page.goto('/catalog')
  await expect(page.getByTestId('catalog-grid')).toBeVisible()
  api.state.status = 401
  await page.reload()
  await expect(page.getByTestId('catalog-grid')).toBeVisible()
  await expect(page.getByTestId('catalog-error')).toContainText('backend API token')
  api.state.status = 200
  await page.getByTestId('catalog-error').getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByTestId('catalog-error')).toHaveCount(0)
  expect(api.state.writes).toEqual([])
})

for (const path of ['/catalog', routeEntryUrl]) {
  test(`catalog publication uses reviewed handoff and retains source on refusal: ${path}`, async ({ page }) => {
    const api = await routeApi(page)
    await page.goto(path)
    await page.getByRole('button', { name: 'Fork & publish', exact: true }).click()
    await expect(page.getByTestId('repository-owner')).toBeVisible()
    await page.getByTestId('repository-owner').fill('fixture')
    await page.getByTestId('repository-name').fill('denied')
    await page.getByTestId('connect-project-repository').click()
    await expect(page.getByRole('dialog')).toContainText(/refused|permissions/i)
    expect(new URL(page.url()).pathname).toBe(path)
    await page.getByRole('dialog').getByRole('button', { name: /Cancel|Close/, exact: true }).first().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]'))).toEqual([routeProject])
    expect(api.state.writes).toEqual([])
  })
}

test('source errors and missing or unauthorized preflight never look like successful data', async ({ page }) => {
  const api = await routeApi(page)
  const release = api.hold('/v1/catalog/sources')
  await page.goto('/sources')
  await expect(page.getByRole('status').filter({ hasText: /Loading/ })).toBeVisible()
  release()
  await expect(page.getByTestId('sources-list')).toBeVisible()
  api.state.status = 503
  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: 'Fixture unavailable' })).toBeVisible()
  api.state.status = 200
  api.state.preflightStatus = 404
  await page.goto('/deployments/route-deployment/preflight')
  await expect(page.getByTestId('preflight-not-found')).toBeVisible()
  await expect(page.getByTestId('preflight-report')).toHaveCount(0)
  api.state.status = 401
  await page.reload()
  await expect(page.getByTestId('preflight-error')).toContainText('backend API token')
  await page.getByTestId('back-to-deployment').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/deployments\/route-deployment$/)
  expect(api.state.writes).toEqual([])
})

test('empty home opens and cancels a keyboard-accessible project form', async ({ page }) => {
  const api = await routeApi(page, [])
  await page.goto('/')
  const create = page.getByRole('button', { name: 'Create Your First Project', exact: true })
  await create.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Create New Project' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Project Name', { exact: true }).fill('Unsaved draft')
  await dialog.getByLabel(/Description/).fill('Do not save on cancel.')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(create).toBeFocused()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]'))).toEqual([])
  expect(api.state.writes).toEqual([])
})

test('home deployment shortcut reviews the project without bypassing saved registration and allocation', async ({ page }) => {
  const api = await routeApi(page)
  await page.goto('/')
  await page.locator('.dropdown > label').first().focus()
  await page.getByTestId('dashboard-quick-deploy').click()
  await expect(page).toHaveURL(/\/project\/route-project\?action=deploy$/)
  await expect(page.getByTestId('project-deployment-review')).toContainText(/saved|Save/)
  await expect(page.getByTestId('deploy-form')).toHaveCount(0)
  expect(api.state.writes).toEqual([])
})
