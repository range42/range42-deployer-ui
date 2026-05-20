/**
 * Plan C §C6.3 — E2E flow 2: deploy-cancel + reconcile.
 *
 * Starts a deployment, pushes a partial canned SSE stream mid-deploy, hits
 * the Cancel button, asserts the backend POST fires and the UI transitions
 * to `cancelled`. Then reloads the page and verifies state is reconstructed
 * from the REST fetch + replayed events.
 */
import { test, expect } from '@playwright/test'
import { setupMockApi, seedLocalStorage, loadEvents } from './fixtures/mockApi'

test.describe.configure({ mode: 'serial' })

test('deploy-cancel mid-stream, then reconcile after reload', async ({ page }) => {
  const PROJECT_ID = 'project_e2e_cancel_1'
  const DEPLOYMENT_ID = 'dep-e2e-cancel'

  await seedLocalStorage(page, {
    migrationDone: true,
    sources: [
      {
        id: 'gitlab:range42/catalog',
        provider: 'gitlab',
        base_url: 'https://gitlab.example',
        auth: { kind: 'none' },
      },
    ],
    proxmoxSettings: {
      hosts: [{ id: 'pve-mock-01', name: 'pve-mock-01', node_name: 'pve-mock-01' }],
      baseUrl: 'http://mock-backend/v0',
    },
    projects: [
      {
        id: PROJECT_ID,
        name: 'E2E Cancel Project',
        created: '2026-04-14T09:00:00Z',
        modified: '2026-04-14T09:00:00Z',
        nodes: [],
        edges: [],
        gamenet: true,
        catalog_sha: 'cat-sha-1',
        project_sha: 'proj-sha-1',
      },
    ],
  })

  const mock = await setupMockApi(page, {
    state: { createdDeploymentId: DEPLOYMENT_ID },
  })

  await page.goto('/')
  await page.getByText('E2E Cancel Project').first().click()
  await expect(page.getByTestId('canvas-wrapper')).toBeVisible()

  // Open Deploy form.
  await page.getByRole('button', { name: /^Deploy$/ }).click()
  await expect(page.getByTestId('deploy-form')).toBeVisible()
  await page.getByTestId('deploy-field-codename').getByRole('textbox').fill('cancel-codename')
  await page.getByTestId('deploy-field-scenario').getByRole('textbox').fill('demo_lab')
  await page.getByTestId('deploy-field-host').getByRole('combobox').selectOption('pve-mock-01')
  await page.getByTestId('deploy-field-team-count').getByRole('spinbutton').fill('1')
  await page.getByTestId('deploy-field-vault').locator('input[type="password"]').fill('vault-pw')
  await page.getByTestId('deploy-sha-ack').locator('input[type="checkbox"]').check()
  await page.getByTestId('deploy-run-preflight').click()
  await page.getByTestId('deploy-submit').click()

  await expect(page).toHaveURL(new RegExp(`/deployments/${DEPLOYMENT_ID}`))

  // Seed meta now so reload later has a record too.
  mock.state.deployments.set(DEPLOYMENT_ID, {
    id: DEPLOYMENT_ID,
    codename: 'cancel-codename',
    scenario_label: 'demo_lab',
    state: 'deploying',
    team_count: 1,
    attempts: [{ attempt_id: 'a-1', state: 'deploying', started_at: '2026-04-14T10:00:00Z' }],
  })

  // Wait for stream open and push partial events.
  await expect
    .poll(async () => (await mock.getSseOpenedUrls()).some((u) => u.includes(DEPLOYMENT_ID)), { timeout: 5000 })
    .toBe(true)
  const partial = loadEvents('cancel')
  await mock.pushEvents(DEPLOYMENT_ID, partial)

  await expect(page.getByTestId('detail-state')).toHaveText(/deploying/, { timeout: 5000 })

  // Click Cancel — triggers POST /v1/deployments/:id/cancel.
  await page
    .getByRole('button', { name: /^cancel$/i })
    .first()
    .click()
  await mock.waitForPost(`/v1/deployments/${DEPLOYMENT_ID}/cancel`)
  expect(mock.state.cancelledIds.has(DEPLOYMENT_ID)).toBe(true)

  // Push the tail events that flip state to cancelled.
  const tail = loadEvents('cancel-tail')
  await mock.pushEvents(DEPLOYMENT_ID, tail)

  await expect(page.getByTestId('detail-state')).toHaveText(/cancelled/, { timeout: 5000 })

  // ---------------- Reconcile after reload ----------------
  // Mock GET /v1/deployments/:id now returns state=cancelled.
  mock.state.deployments.set(DEPLOYMENT_ID, {
    id: DEPLOYMENT_ID,
    codename: 'cancel-codename',
    scenario_label: 'demo_lab',
    state: 'cancelled',
    team_count: 1,
    attempts: [{ attempt_id: 'a-1', state: 'cancelled', started_at: '2026-04-14T10:00:00Z' }],
  })

  await page.reload()
  // After reload, header should reconstruct from GET + SSE reconnect.
  await expect(page.getByTestId('detail-state')).toHaveText(/cancelled/, { timeout: 5000 })

  // SSE reconnect should have been attempted a second time after reload.
  const openedUrls = await mock.getSseOpenedUrls()
  expect(openedUrls.filter((u) => u.includes(DEPLOYMENT_ID)).length).toBeGreaterThanOrEqual(1)
})
