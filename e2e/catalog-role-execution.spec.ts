import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi } from './fixtures/mockApi'
import { replicatedScenario } from '../src/__tests__/fixtures/replicatedScenario'
import fixture from '../src/__tests__/fixtures/catalogRoleNtp.json' with { type: 'json' }

for (const width of [1440, 390]) {
  test(`imported default role attaches in order and survives scenario reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const input = replicatedScenario()
    const project = { id: 'role-execution', name: 'Role execution', ...input,
      nodes: input.nodes.map((node, index) => ({ ...node, position: { x: 80 + index * 250, y: 80 } })) }
    const source = { id: 'imported-ntp', name: 'NTP source', nodes: [], edges: [], files: fixture.files,
      catalogRef: { version: 1, kind: 'ansible_role', mode: 'customize', source_id: 'catalog', provider: 'github',
        base_url: 'https://github.com', repo_owner: 'range42', repo_name: 'catalog', path: fixture.path, sha: fixture.sha } }
    await page.addInitScript(data => {
      if (localStorage.getItem('role-execution-seeded')) return
      localStorage.setItem('range42_projects', JSON.stringify(data))
      localStorage.setItem('range42_migration_v1_done', '1')
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', url: location.origin, label: 'Fixture' }], activeHostId: 'backend', seeded: true }))
      localStorage.setItem('role-execution-seeded', '1')
    }, [project, source])
    await setupMockApi(page)
    const writes: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.method() !== 'GET') writes.push(request.method() + ' ' + new URL(request.url()).pathname) })
    await page.goto('/project/role-execution')
    await page.getByTestId('project-scenario').click()
    const scenario = page.getByRole('dialog', { name: 'Configure executable scenario' })
    await scenario.getByTestId('scenario-add-role').click()
    const picker = page.getByRole('dialog', { name: 'Attach an imported catalog role' })
    await picker.getByTestId('role-review').click()
    await expect(picker.getByTestId('role-review-summary')).toContainText('7 current files')
    expect((await new AxeBuilder({ page }).include('[aria-labelledby="role-attachment-title"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    expect(await picker.locator('.modal-box').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await picker.getByTestId('role-attach').click()
    await expect(picker).not.toBeVisible()
    const role = scenario.locator('fieldset').filter({ has: page.getByText('Original catalog commit:', { exact: false }) })
    await role.getByRole('textbox', { name: 'Non-secret variables (JSON)' }).fill('{"service_label":"reviewed"}')
    await role.getByRole('button', { name: 'Move up', exact: true }).click()
    await scenario.getByTestId('scenario-review').click()
    await scenario.getByTestId('scenario-apply').click()
    await expect(scenario).not.toBeVisible()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('range42_projects') || '[]'))
    expect(saved[1].files).toEqual(fixture.files)
    expect(saved[0].scenario.content.map(item => item.kind)).toEqual(['role', 'file'])
    expect(saved[0].scenario.content[0].vars).toEqual({ service_label: 'reviewed' })
    const roles = JSON.parse(saved[0].files['scenarios/replicated/manifest/scenario_roles.json'])
    expect(roles.attachments.map(item => item.vm_id)).toEqual([3101, 3102, 3103])
    expect(roles.attachments.every(item => item.role.origin.sha === fixture.sha)).toBe(true)
    for (const [path, value] of Object.entries(fixture.files)) expect(saved[0].files[path]).toBe(value)
    await page.reload()
    await page.getByTestId('project-scenario').click()
    await expect(scenario.getByText(`Original catalog commit: ${fixture.sha}`, { exact: false })).toBeVisible()
    await scenario.getByTestId('scenario-review').click()
    await expect(scenario.getByTestId('scenario-apply')).toBeVisible()
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
}
