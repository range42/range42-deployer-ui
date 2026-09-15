import { describe, expect, it } from 'vitest'
import { visibleDeploymentLogs } from '@/services/deploymentLogs'

describe('deployment log verbosity', () => {
  const lines = [
    { text: 'result from script', ansible_event: 'runner_on_ok' },
    { text: 'a skipped task', ansible_event: 'runner_on_skipped' },
    { text: 'include a file', ansible_event: 'playbook_on_include' },
    { text: 'TASK [role]', task_action: 'ansible.builtin.include_role' },
    { text: 'script says include and skipped', ansible_event: 'verbose' },
    { text: 'fatal: [vm1] failure', ansible_event: 'runner_on_failed', task_action: 'include_tasks' },
  ]
  it('hides routine skipped/include noise but keeps failures and ordinary output', () => {
    expect(visibleDeploymentLogs(lines).map(line => line.text)).toEqual([lines[0].text, lines[4].text, lines[5].text])
    expect(lines).toHaveLength(6)
  })
  it('shows the complete retained log buffer when requested, including search matches', () => {
    expect(visibleDeploymentLogs(lines, { showRoutine: true })).toEqual(lines)
    expect(visibleDeploymentLogs(lines, { showRoutine: true, query: 'ROLE' })).toEqual([lines[3]])
  })
  it('recognizes historical Ansible skip/include prefixes only without explicit metadata', () => {
    expect(visibleDeploymentLogs([
      { text: 'skipping: [vm1]' }, { text: 'included: /tmp/tasks.yml for vm1' },
      { text: 'included: /tmp/tasks.yml', ansible_event: 'verbose' },
      { text: 'we skipped a line in this script' },
    ]).map(line => line.text)).toEqual(['included: /tmp/tasks.yml', 'we skipped a line in this script'])
  })
})
