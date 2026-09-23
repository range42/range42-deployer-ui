// Keep canonical catalog units authoritative while supporting existing canvas files.
export const vmMemoryMb = config => Object.hasOwn(config, 'memory_mb') ? config.memory_mb : config.memory

function diskGb(value) {
  const match = String(value).match(/^([0-9]+)(?:G(?:iB)?)?$/i)
  return match ? Number(match[1]) : value
}

export const vmDiskGb = config => Object.hasOwn(config, 'disk_gb') ? config.disk_gb : diskGb(config.diskSize)

export function setVmMemoryMb(config, value) {
  if (Object.hasOwn(config, 'memory_mb')) {
    config.memory_mb = value
    delete config.memory
  } else config.memory = value
}

export function setVmDiskSize(config, value) {
  if (Object.hasOwn(config, 'disk_gb')) {
    config.disk_gb = diskGb(value)
    delete config.diskSize
  } else config.diskSize = value
}
