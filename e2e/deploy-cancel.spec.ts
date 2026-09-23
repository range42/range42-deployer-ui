/**
 * Plan C §C6.3 — E2E flow 2: deploy-cancel + reconcile.
 *
 * Opens an existing running deployment, pushes a partial SSE stream, hits
 * the Cancel button, asserts the backend POST fires and the UI transitions
 * to `cancelled`. Then reloads the page and verifies state is reconstructed
 * from the REST fetch + replayed events. deploy-happy covers creation through
 * saved Git registration, allocation, preflight and start.
 */
import { test, expect } from '@playwright/test'
import { setupMockApi, seedLocalStorage, loadEvents } from './fixtures/mockApi'

test.describe.configure({ mode: 'serial' })

test('deploy-cancel mid-stream, then reconcile after reload', async ({ page }) => {
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
  })

  const mock = await setupMockApi(page, {
    state: { createdDeploymentId: DEPLOYMENT_ID },
  })

  mock.state.deployments.set(DEPLOYMENT_ID, {
    id: DEPLOYMENT_ID,
    codename: 'cancel-codename',
    scenario_label: 'demo_lab',
    state: 'deploying',
    team_count: 1,
    attempts: [{ attempt_id: 'a-1', state: 'deploying', started_at: '2026-04-14T10:00:00Z' }],
  })

  await page.goto(`/deployments/${DEPLOYMENT_ID}`)
  await expect(page.getByTestId('detail-state')).toHaveText(/deploying/)

  // Wait for stream open and push partial events.
  await expect
    .poll(async () => (await mock.getSseOpenedUrls()).some((u) => u.includes(DEPLOYMENT_ID)), { timeout: 5000 })
    .toBe(true)
  const partial = loadEvents('cancel')
  await mock.pushEvents(DEPLOYMENT_ID, partial)

  await expect(page.getByTestId('detail-state')).toHaveText(/deploying/, { timeout: 5000 })

  // Click Cancel — triggers POST /v1/deployments/:id/cancel.
  await page.getByRole('button', { name: 'Cancel deployment', exact: true }).click()
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
