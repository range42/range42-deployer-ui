/** Filtering affects presentation only; the event history remains complete. */
export function visibleDeploymentLogs(lines, { showRoutine = false, query = '' } = {}) {
  const needle = query.toLowerCase()
  return lines.filter(line => {
    if (needle && !(line.text || '').toLowerCase().includes(needle)) return false
    if (showRoutine || line.stream === 'stderr' || ['runner_on_failed', 'runner_on_unreachable'].includes(line.ansible_event)) return true
    if (['runner_on_skipped', 'playbook_on_include'].includes(line.ansible_event)) return false
    if (/^(?:ansible\.builtin\.)?include_(?:role|tasks)$/.test(line.task_action || '')) return false
    return Boolean(line.ansible_event) || !/^\s*(?:skipping: \[|included: )/.test(line.text || '')
  })
}
