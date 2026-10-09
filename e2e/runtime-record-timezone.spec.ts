import { test, expect } from '@playwright/test'

for (const timezoneId of ['UTC', 'Europe/Luxembourg']) {
  test.describe(`runtime records in ${timezoneId}`, () => {
    test.use({ timezoneId })

    test('serializes backend UTC timestamps identically in the real browser', async ({ page }) => {
      // Load the real Vite module on an empty page without starting application workflows.
      await page.route('**/runtime-record-timezone-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Runtime record fixture</title>' }))
      await page.goto('/runtime-record-timezone-fixture')
      const actual = await page.evaluate(async () => {
        const modulePath = '/src/services/runtimeGitRecords.js'
        const { buildRuntimeRecord } = await import(modulePath)
        const deployment = { id: 'deployment-1', scenario_label: 'demo', target_host_id: 'host-1' }
        const attempt = { id: 'attempt-1', deployment_id: deployment.id, state: 'succeeded', rc: 0,
          operation: { project_sha: 'a'.repeat(40), target_host_id: 'host-1', request: { kind: 'runtime_observe' } },
          operation_result: { desired_reached: true, partial: false } }
        return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          records: ['2026-09-24T20:15:48.356086', '2026-09-24T20:15:48.356086Z', '2026-09-24T22:15:48.356086+02:00']
            .map(ended_at => buildRuntimeRecord(deployment, { ...attempt, ended_at }, 'https://backend.test')) }
      })
      expect(actual.timezone).toBe(timezoneId)
      expect(actual.records[1]).toEqual(actual.records[0])
      expect(actual.records[2]).toEqual(actual.records[0])
      expect(JSON.parse(actual.records[0].content)).toMatchObject({ version: 2, ended_at: '2026-09-24T20:15:48.356Z' })
    })
  })
}
