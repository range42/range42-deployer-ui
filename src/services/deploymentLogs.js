/** Filtering affects presentation only; the event history remains complete. */
export function visibleDeploymentLogs(lines, { showRoutine = false, query = '' } = {}) {
  const needle = query.toLowerCase()
  const escape = String.fromCharCode(27)
  const bell = String.fromCharCode(7)
  const title = new RegExp(`${escape}\\][^${bell}${escape}]*(?:${bell}|${escape}\\\\)`, 'g')
  const formatting = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g')
  return lines.map(line => {
    const text = String(line.text ?? '').replace(title, '').replace(formatting, '')
    return text === line.text ? line : { ...line, text }
  }).filter(line => {
    if (needle && !(line.text || '').toLowerCase().includes(needle)) return false
    if (showRoutine || line.stream === 'stderr' || ['runner_on_failed', 'runner_on_unreachable'].includes(line.ansible_event)) return true
    if (['runner_on_skipped', 'playbook_on_include'].includes(line.ansible_event)) return false
    if (/^(?:ansible\.builtin\.)?include_(?:role|tasks)$/.test(line.task_action || '')) return false
    return Boolean(line.ansible_event) || !/^\s*(?:skipping: \[|included: )/.test(line.text || '')
  })
}
