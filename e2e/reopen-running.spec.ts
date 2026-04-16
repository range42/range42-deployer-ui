/**
 * Plan C §C6.5 — E2E flow 4: reopen running deployment (SSE reconnect + cursor replay).
 *
 * Seeds a running deployment with a known events cursor (1200), navigates
 * directly to /deployments/:id, asserts the SSE reconnect URL carries
 * `from_cursor=1200` (after the tail is pushed and the last seq advances).
 * Also simulates an error-close on the stream and confirms auto-reconnect
 * issues a fresh EventSource with an incremented cursor.
 */
import { test, expect } from '@playwright/test'
import { setupMockApi, seedLocalStorage, loadEvents } from './fixtures/mockApi'

test.describe.configure({ mode: 'serial' })

test('reopen running deployment reconnects SSE and replays from cursor', async ({ page }) => {
  const DEPLOYMENT_ID = 'dep-e2e-reopen'

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

  const mock = await setupMockApi(page)
  mock.state.deployments.set(DEPLOYMENT_ID, {
    id: DEPLOYMENT_ID,
    codename: 'running-codename',
    scenario_label: 'demo_lab',
    state: 'deploying',
    team_count: 1,
    attempts: [{ attempt_id: 'a-1', state: 'deploying', started_at: '2026-04-14T10:00:00Z' }],
  })

  // Open detail page directly.
  await page.goto(`/deployments/${DEPLOYMENT_ID}`)
  await expect(page.getByTestId('detail-state')).toBeVisible({ timeout: 5000 })

  // Initial open: cursor is 0 (store starts empty).
  await expect
    .poll(
      async () =>
        (await mock.getSseOpenedUrls()).filter((u) => u.includes(DEPLOYMENT_ID)),
      { timeout: 5000 },
    )
    .toHaveLength(1)

  const firstOpen = (await mock.getSseOpenedUrls()).filter((u) => u.includes(DEPLOYMENT_ID))[0]
  expect(firstOpen).toMatch(/from_cursor=0/)

  // Push the canned "prefix" events (event_seq = 1200..1202) — these advance
  // last_event_seq so a reconnect should carry `from_cursor=1202`.
  const prefix = loadEvents('reconnect-prefix')
  await mock.pushEvents(DEPLOYMENT_ID, prefix)

  // Force a close: fakes an onerror which kicks the store's reconnect timer.
  await mock.closeStream(DEPLOYMENT_ID)

  // Second EventSource opens with the advanced cursor.
  await expect
    .poll(
      async () =>
        (await mock.getSseOpenedUrls()).filter((u) => u.includes(DEPLOYMENT_ID)),
      { timeout: 10_000 },
    )
    .toHaveLength(2)

  const urls = (await mock.getSseOpenedUrls()).filter((u) => u.includes(DEPLOYMENT_ID))
  const lastUrl = urls[urls.length - 1]
  expect(lastUrl).toMatch(/from_cursor=1202/)

  // Push the tail events and confirm the UI reaches terminal state.
  const tail = loadEvents('reconnect-tail')
  await mock.pushEvents(DEPLOYMENT_ID, tail)

  await expect(page.getByTestId('detail-state')).toHaveText(/deployed/, { timeout: 5000 })
})
