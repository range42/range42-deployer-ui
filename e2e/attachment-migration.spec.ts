import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setupMockApi } from './fixtures/mockApi'
import { savedScenario } from '../src/__tests__/fixtures/savedScenario'

for (const width of [1440, 390]) {
  test(`reviews and persists legacy content conversion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const input = savedScenario()
    const project = { ...input, git: undefined, id: 'migration-browser', attachments: [
      { id: 'tasks', target_node: 'vm1', stage: 'main', order_in_stage: 1, vars: { MESSAGE: 'preserved' },
        source: { kind: 'inline_yaml', content_inline: '\uFEFF- ansible.builtin.debug:\r\n    msg: "{{ MESSAGE }}"\r\n' } },
      { id: 'binary', target_node: 'vm1', stage: 'main', order_in_stage: 2,
        source: { kind: 'file_upload', content_inline: 'AP+ACg==' } },
    ] }
    await page.addInitScript(data => {
      if (localStorage.getItem('migration-browser-seeded')) return
      localStorage.setItem('range42_projects', JSON.stringify([data]))
      localStorage.setItem('range42_migration_v1_done', '1')
      localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'fixture', url: location.origin, token: 'fixture', label: 'Fixture' }], activeHostId: 'fixture', seeded: true }))
      localStorage.setItem('migration-browser-seeded', '1')
    }, project)
    await setupMockApi(page)
    await page.route(/\/v1\/proxmox\/hosts\?/, route => route.fulfill({ json: { items: [], total: 0 } }))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/project/${project.id}`)
    await expect(page.getByTestId('canvas-wrapper')).toBeVisible()
    await page.getByTestId('project-tab-config').click()
    await page.getByTestId('attachment-manager').getByTestId('scenario-content-btn').click()
    const dialog = page.getByRole('dialog', { name: 'Configure executable scenario' })
    await expect(dialog.getByTestId('attachment-migration')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close scenario configuration' }).click()
    const stored = () => page.evaluate(id => JSON.parse(localStorage.getItem('range42_projects') || '[]').find(project => project.id === id), project.id)
    expect((await stored()).attachments).toEqual(project.attachments)
    await page.getByTestId('attachment-manager').getByTestId('scenario-content-btn').click()
    await dialog.getByTestId('migration-kind').selectOption('file')
    await dialog.getByTestId('migration-destination').fill('/tmp/preserved.bin')
    await dialog.getByTestId('migration-confirm').check()
    const violations = (await new AxeBuilder({ page }).include('[aria-labelledby="scenario-authoring-title"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
    expect(await dialog.locator('.modal-box').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await dialog.getByTestId('attachment-migration').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/r42-attachment-migration-${width}.png` })
    await dialog.getByTestId('scenario-review').click()
    await expect(dialog.getByTestId('migration-summary')).toContainText('2 legacy attachments')
    expect((await stored()).attachments).toEqual(project.attachments)
    await dialog.getByTestId('scenario-apply').click()
    await expect(dialog).not.toBeVisible()
    const result = await stored()
    expect(result.attachments).toEqual([])
    expect(result.scenario.content).toHaveLength(3)
    expect(result.files['scenarios/saved/content/legacy-1.tasks.yml']).toBe(project.attachments[0].source.content_inline)
    expect(result.files['scenarios/saved/content/legacy-2.bin'].content).toBe('AP+ACg==')
    expect(JSON.parse(result.files['scenarios/saved/content/legacy-attachments.json']).attachments).toEqual(project.attachments)
    expect(result.files['notes.txt']).toBe(project.files['notes.txt'])
    await page.reload()
    await page.getByTestId('project-scenario').click()
    await expect(dialog.getByTestId('attachment-migration')).toHaveCount(0)
    await expect(dialog.getByTestId('content-path')).toHaveCount(3)
    await dialog.getByTestId('scenario-review').click()
    await dialog.getByTestId('scenario-apply').click()
    await expect(dialog).not.toBeVisible()
    expect((await stored()).files).toEqual(result.files)
    expect(errors).toEqual([])
  })
}
