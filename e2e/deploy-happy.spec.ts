/**
 * Plan C §C6.2 — E2E flow 1: happy-path deploy.
 *
 * Seeds a migration-complete local state with one project + one source +
 * one proxmox host. Navigates home → project editor → Deploy form →
 * preflight → submit → deployment detail, then streams a canned SSE
 * sequence and asserts the 3-team grid reaches `deployed`.
 */
import { test, expect } from '@playwright/test'
import { setupMockApi, seedLocalStorage, loadEvents } from './fixtures/mockApi'

test.describe.configure({ mode: 'serial' })

test('happy-path deploy: home → project → deploy form → live teams grid', async ({ page }) => {
  const PROJECT_ID = 'project_e2e_happy_1'
  const DEPLOYMENT_ID = 'dep-e2e-happy'

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
        name: 'E2E Happy Project',
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
    state: {
      createdDeploymentId: DEPLOYMENT_ID,
    },
  })

  // Home — dashboard should render (first-run skipped because seeded state).
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)

  // Open the seeded project from the dashboard card.
  await page.getByText('E2E Happy Project').first().click()
  await expect(page).toHaveURL(new RegExp(`/project/${PROJECT_ID}`))

  // Wait for canvas wrapper to mount.
  await expect(page.getByTestId('canvas-wrapper')).toBeVisible()

  // Click Deploy in the Sidebar to open the DeployForm.
  await page.getByRole('button', { name: /^Deploy$/ }).click()
  await expect(page.getByTestId('deploy-form')).toBeVisible()

  // Fill the form.
  await page.getByTestId('deploy-field-codename').getByRole('textbox').fill('happy-codename')
  await page.getByTestId('deploy-field-scenario').getByRole('textbox').fill('demo_lab')
  await page.getByTestId('deploy-field-host').getByRole('combobox').selectOption('pve-mock-01')
  await page.getByTestId('deploy-field-team-count').getByRole('spinbutton').fill('3')
  await page.getByTestId('deploy-field-vault').locator('input[type="password"]').fill('vault-pw')

  // Acknowledge SHA pin.
  await page.getByTestId('deploy-sha-ack').locator('input[type="checkbox"]').check()

  // Run preflight inline — canned response returns pass/pass (no warn/block).
  await page.getByTestId('deploy-run-preflight').click()
  await expect(page.getByTestId('deploy-preflight-block')).toHaveCount(0)

  // Submit — should navigate to /deployments/:id.
  await page.getByTestId('deploy-submit').click()
  await expect(page).toHaveURL(new RegExp(`/deployments/${DEPLOYMENT_ID}`))

  // Wait for meta load + SSE subscribe.
  await expect(page.getByTestId('detail-state')).toBeVisible()

  // Seed deployments map to keep GET /v1/deployments/:id consistent post-POST.
  mock.state.deployments.set(DEPLOYMENT_ID, {
    id: DEPLOYMENT_ID,
    codename: 'happy-codename',
    scenario_label: 'demo_lab',
    state: 'deploying',
    team_count: 3,
    attempts: [{ attempt_id: 'a-1', state: 'deploying', started_at: '2026-04-14T10:00:00Z' }],
  })

  // Wait until the EventSource actually opened for this deployment.
  await expect
    .poll(async () => (await mock.getSseOpenedUrls()).some((u) => u.includes(DEPLOYMENT_ID)), { timeout: 5000 })
    .toBe(true)

  // Push the canned happy sequence.
  const events = loadEvents('happy')
  await mock.pushEvents(DEPLOYMENT_ID, events)

  // Switch to Teams tab — default would pick it, but be explicit.
  await page.getByTestId('tab-teams').click()

  // Assert grid renders 3 team cards.
  await expect.poll(async () => await page.getByTestId('team-card').count(), { timeout: 5000 }).toBe(3)

  // All three teams should reach `deployed` status badge text.
  for (const teamId of ['team-1', 'team-2', 'team-3']) {
    await expect
      .poll(async () => {
        const cards = await page.getByTestId('team-card').all()
        for (const c of cards) {
          const html = await c.innerHTML()
          if (html.includes(teamId) && /deployed|success/i.test(html)) return true
        }
        return false
      }, { timeout: 5000 })
      .toBe(true)
  }

  // Terminal state surfaced in the header badge.
  await expect(page.getByTestId('detail-state')).toHaveText(/deployed/, { timeout: 5000 })
})
