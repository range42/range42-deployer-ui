/**
 * Plan C §C6.4 — E2E flow 3: fork-and-reuse.
 *
 * Open the catalog list, click "Fork & publish" on an entry, fill the
 * target repo + name, submit — the UI navigates to the new catalog entry
 * route. A second canned entry under the new source makes the page load
 * successfully, after which "Use" creates a project and lands the user on
 * the project editor.
 */
import { test, expect } from '@playwright/test'
import { setupMockApi, seedLocalStorage, type CatalogEntry } from './fixtures/mockApi'

test.describe.configure({ mode: 'serial' })

test('fork catalog entry then use the fork to create a project', async ({ page }) => {
  const ORIGIN_ENTRY: CatalogEntry = {
    kind: 'gamenet',
    name: 'origin-lab',
    description: 'Origin entry to fork from',
    source_id: 'gitlab:range42/catalog',
    path: 'gamenets/origin/range42.yaml',
    sha: 'orig-sha',
    readme: '# origin-lab\n\nOriginal entry.\n',
    tags: ['origin'],
    topology: { kind: 'gamenet' },
  }
  const FORK_ENTRY: CatalogEntry = {
    kind: 'gamenet',
    name: 'my-fork',
    description: 'Fork under acme/playground',
    source_id: 'gitlab:acme/playground',
    path: 'range42.yaml',
    sha: 'fork-sha',
    readme: '# my-fork\n\nForked copy.\n',
    tags: ['fork'],
    topology: { kind: 'gamenet' },
  }

  await seedLocalStorage(page, {
    migrationDone: true,
    sources: [
      {
        id: 'gitlab:range42/catalog',
        provider: 'gitlab',
        base_url: 'https://gitlab.example',
        auth: { kind: 'none' },
      },
      // Add the post-fork source now so the mock entry resolves when the
      // user navigates to the fork detail page. In real flow the UI would
      // register the source itself; pre-seeding is close enough for E2E.
      {
        id: 'gitlab:acme/playground',
        provider: 'gitlab',
        base_url: 'https://gitlab.example',
        auth: { kind: 'none' },
      },
    ],
  })

  const mock = await setupMockApi(page, {
    state: {
      catalog: [ORIGIN_ENTRY],
    },
  })

  // Navigate to catalog list.
  await page.goto('/catalog')
  await expect(page.getByTestId('catalog-grid')).toBeVisible({ timeout: 5000 })

  // Click Fork button on the origin tile.
  await page.getByRole('button', { name: /^fork/i }).first().click()

  // Fill fork modal.
  const repoInput = page.locator('input[placeholder="owner/repo"]')
  await expect(repoInput).toBeVisible()
  await repoInput.fill('acme/playground')

  // Before submitting, make the fork entry discoverable in the mock.
  mock.state.catalog.push(FORK_ENTRY)

  // Submit fork — navigates to /catalog/:source/:entry.
  const submitBtn = page
    .getByRole('dialog')
    .getByRole('button')
    .filter({ hasText: /fork|submit|publish/i })
    .last()
  await submitBtn.click()

  // Landing URL is the new entry detail page.
  await expect(page).toHaveURL(/\/catalog\/.*playground/)

  // Entry detail renders with verb buttons.
  await expect(page.getByTestId('entry-verbs')).toBeVisible({ timeout: 5000 })

  // Click "Use" — creates a project + navigates to /project/:id?tab=canvas.
  await page
    .getByTestId('entry-verbs')
    .getByRole('button')
    .first()
    .click()

  await expect(page).toHaveURL(/\/project\/project_/, { timeout: 5000 })
  await expect(page.getByTestId('canvas-wrapper')).toBeVisible()
})
