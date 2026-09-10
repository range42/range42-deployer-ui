/** Descriptor-driven caller values. VM targets and vault values never enter saved input. */
export interface BundleParameter {
  name: string
  type?: string
  description?: string
  required?: boolean
  target?: boolean
  from_vault?: boolean
  default_where?: string
  default?: unknown
  allowed?: unknown[]
  enum?: unknown[]
  bool_style?: string
}

export function managedBundleParameter(param: BundleParameter, targetVars: string[] = []): boolean {
  return param.target === true || param.from_vault === true || targetVars.includes(param.name)
}

function validateDescriptors(params: BundleParameter[]) {
  const names = new Set<string>()
  for (const param of params) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(param.name) || ['__proto__', 'constructor', 'prototype'].includes(param.name)) {
      throw new Error(`Invalid bundle parameter name: ${param.name}`)
    }
    if (names.has(param.name)) throw new Error(`Duplicate bundle parameter: ${param.name}`)
    names.add(param.name)
  }
}

function typedValue(param: BundleParameter, raw: unknown): unknown {
  switch (param.type || 'string') {
    case 'str':
    case 'string':
      if (typeof raw !== 'string') throw new Error(`${param.name} must be text`)
      return raw
    case 'int': {
      if ((typeof raw !== 'string' && typeof raw !== 'number') || !Number.isSafeInteger(Number(raw))) {
        throw new Error(`${param.name} must be a whole number`)
      }
      return Number(raw)
    }
    case 'bool': {
      if (raw === true || /^(true|yes)$/i.test(String(raw))) return true
      if (raw === false || /^(false|no)$/i.test(String(raw))) return false
      throw new Error(`${param.name} must be true or false`)
    }
    case 'dict':
    case 'list': {
      let value = raw
      try { if (typeof raw === 'string') value = JSON.parse(raw) } catch { /* report the expected type below */ }
      if (param.type === 'list' ? !Array.isArray(value) : !isObject(value)) throw new Error(`${param.name} must be a JSON ${param.type === 'list' ? 'list' : 'object'}`)
      return value
    }
    default: throw new Error(`Unsupported parameter type for ${param.name}: ${param.type}`)
  }
}

export function bundleDefaults(params: BundleParameter[], targetVars: string[] = []): Record<string, unknown> {
  validateDescriptors(params)
  return Object.fromEntries(params.filter(param => !managedBundleParameter(param, targetVars)).map(param => {
    let value: unknown = ''
    if (param.default !== undefined && param.default !== null && param.default !== '' && !hasTemplate(param.default)) {
      try { value = typedValue(param, param.default) } catch { /* expressions remain bundle defaults */ }
    }
    return [param.name, (Array.isArray(value) || isObject(value)) ? JSON.stringify(value, null, 2) : value]
  }))
}

export function bundleParameters(params: BundleParameter[], input: Record<string, unknown>, targetVars: string[] = []): Record<string, unknown> {
  validateDescriptors(params)
  const editable = params.filter(param => !managedBundleParameter(param, targetVars))
  for (const name of Object.keys(input)) {
    if (!editable.some(param => param.name === name)) throw new Error(`Unknown or managed bundle parameter: ${name}`)
  }
  const values = []
  for (const param of editable) {
    const raw = input[param.name]
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
      if (requiredBundleParameter(param)) throw new Error(`Required bundle parameter: ${param.name}`)
      continue
    }
    let value = typedValue(param, raw)
    if (param.type === 'bool' && param.bool_style === 'yesno') value = value ? 'YES' : 'NO'
    values.push([param.name, value])
  }
  const result = Object.fromEntries(values)
  validateBundleParameters(params, result, targetVars)
  return result
}


function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function hasTemplate(value: unknown): boolean {
  return /{{|{%|{#/.test(JSON.stringify(value) || '')
}
export function requiredBundleParameter(param: BundleParameter): boolean {
  return param.required === true && !Object.hasOwn(param, 'default') && (param.default_where || 'none') === 'none'
}
export function bundleChoices(param: BundleParameter): unknown[] {
  return param.allowed ?? param.enum ?? []
}
/** Validate serialized caller values as-is; never coerce a saved manifest's inputs. */
export function validateBundleParameters(params: BundleParameter[], values: Record<string, unknown>, targetVars: string[] = []): void {
  validateDescriptors(params)
  if (!isObject(values) || new TextEncoder().encode(JSON.stringify(values)).length > 65536) {
    throw new Error('Bundle parameters must be a bounded named object')
  }
  for (const [name, value] of Object.entries(values)) {
    const param = params.find(candidate => candidate.name === name)
    if (!param || managedBundleParameter(param, targetVars)) throw new Error(`Unknown or managed bundle parameter: ${name}`)
    const type = param.type || 'string'
    const valid = type === 'string' || type === 'str' ? typeof value === 'string'
      : type === 'int' ? typeof value === 'number' && Number.isSafeInteger(value)
      : type === 'bool' ? (param.bool_style === 'yesno' ? ['YES', 'NO'].includes(value as string) : typeof value === 'boolean')
      : type === 'list' ? Array.isArray(value)
      : type === 'dict' ? isObject(value) : false
    if (!valid || hasTemplate(value)) throw new Error(`Invalid parameter type or template expression: ${name}`)
    const choices = bundleChoices(param)
    if (choices.length && !choices.some(allowed => JSON.stringify(allowed) === JSON.stringify(value))) {
      throw new Error(`Choose an allowed value for ${name}`)
    }
  }
  for (const param of params) {
    if (!managedBundleParameter(param, targetVars) && requiredBundleParameter(param) && !Object.hasOwn(values, param.name)) {
      throw new Error(`Required bundle parameter: ${param.name}`)
    }
  }
}

