export const CONFIG_WRITE_UNAVAILABLE = 'Apply is unavailable until the API supports configuration writes bound to the selected host. Your desired edits are preserved.'

/** Only complete observations can replace the five editable fields. */
export function observedConfig(raw: Record<string, unknown>, vmtype: 'qemu' | 'lxc') {
  const name = vmtype === 'lxc' ? raw.hostname : raw.name
  const positiveInteger = (value: unknown) => {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return false
    return Number.isSafeInteger(Number(value)) && Number(value) > 0
  }
  if (typeof name !== 'string' || !name || !positiveInteger(raw.cores) || !positiveInteger(raw.memory)
    || (raw.tags !== undefined && typeof raw.tags !== 'string')
    || (raw.description !== undefined && typeof raw.description !== 'string')) {
    throw new Error('Guest configuration response is incomplete or invalid.')
  }
  return { name, cores: Number(raw.cores), memory: Number(raw.memory),
    tags: typeof raw.tags === 'string' ? raw.tags.split(';').filter(Boolean) : [],
    description: typeof raw.description === 'string' ? raw.description : '' }
}
