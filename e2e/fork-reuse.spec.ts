import { test, expect } from '@playwright/test'
import { routeApi, routeEntry, routeProject } from './fixtures/routeApi'
import fixture from '../src/__tests__/fixtures/catalogRoleNtp.json' with { type: 'json' }

test('fork publication reviews a writable destination and imports the complete pinned role', async ({ page }) => {
  const api = await routeApi(page)
  api.state.catalog = [{ ...routeEntry, sha: fixture.sha }]
  await page.route('https://api.github.com/**', async route => {
    const request = route.request(), url = new URL(request.url())
    expect(request.method()).toBe('GET') // Review/import never forks, commits or publishes remotely.
    if (url.pathname === '/repos/fixture/work') return route.fulfill({ json: { permissions: { push: true } } })
    if (url.pathname.endsWith('/commits')) return route.fulfill({ status: url.searchParams.get('sha')?.startsWith('range42-ui/') ? 404 : 200,
      json: url.searchParams.get('sha')?.startsWith('range42-ui/') ? { message: 'Not Found' } : [{ sha: 'b'.repeat(40), commit: { message: 'Base', author: {} } }] })
    if (url.pathname.includes('/git/trees/')) return route.fulfill({ json: {
      tree: url.pathname.includes('/range42/range42-catalog/') ? fixture.tree : [], truncated: false,
    } })
    if (url.pathname.includes('/contents/')) {
      const path = decodeURIComponent(url.pathname.split('/contents/')[1]) as keyof typeof fixture.files
      expect(url.searchParams.get('ref')).toBe(fixture.sha)
      return route.fulfill({ json: { content: Buffer.from(fixture.files[path]).toString('base64'), encoding: 'base64',
        sha: fixture.tree.find(file => file.path === path)!.sha } })
    }
    throw new Error(`Unexpected provider read ${url.pathname}`)
  })
  await page.goto('/catalog')
  await page.getByRole('button', { name: 'Fork & publish', exact: true }).click()
  await page.getByTestId('repository-owner').fill('fixture')
  await page.getByTestId('repository-name').fill('work')
  await page.getByTestId('repository-subdir').fill('projects/ntp')
  await page.getByTestId('connect-project-repository').click()
  await expect(page.getByTestId('catalog-handoff-preview')).toContainText('7 role files')
  await expect(page.getByRole('dialog')).toContainText('Nothing has been published yet')
  await page.getByTestId('catalog-handoff-import').click()
  await expect(page).toHaveURL(/\/project\/project_[a-f0-9]+\?tab=config$/)
  await expect(page.getByTestId('file-tree-list')).toBeVisible()
  const projects = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]'))
  expect(projects[0]).toEqual(routeProject)
  expect(projects[1].files).toEqual(fixture.files)
  expect(projects[1].git).toMatchObject({ repo_owner: 'fixture', repo_name: 'work', branch_from: 'b'.repeat(40) })
  expect(projects[1].catalogRef).toMatchObject({ repo_owner: 'range42', sha: fixture.sha, path: fixture.path })
  await page.reload()
  await expect(page.getByTestId('project-catalog-origin')).toContainText(fixture.sha)
  expect(api.state.writes).toEqual([])
  expect(api.state.unexpected).toEqual([])
})
