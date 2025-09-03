import { createI18n } from 'vue-i18n'
import { DEFAULT_LOCALE, isSupportedLocale } from './supported'

// Build an allowlisted module map at build time
// Keys look like: '../locales/en/sidebar.json', '../locales/fr/nodes/infra-node-vm.json'
const modules = import.meta.glob('../locales/*/**/*.json')

const loaded = new Map() // Map(locale -> Set(namespaces))

export const i18n = createI18n({
  legacy: false,
  locale: (() => {
    const saved = localStorage.getItem('locale')
    return isSupportedLocale(saved) ? saved : DEFAULT_LOCALE
  })(),
  fallbackLocale: DEFAULT_LOCALE,
  messages: {},
})

// Ensure <html lang="..."> reflects current locale
document.documentElement.lang = i18n.global.locale.value

function resolveModuleKey(locale, ns) {
  const key = `../locales/${locale}/${ns}.json`
  return modules[key] ? key : null
}

export async function loadNamespace(locale, ns) {
  const set = loaded.get(locale) || new Set()
  if (set.has(ns)) return
  const key = resolveModuleKey(locale, ns)
  if (!key) {
    console.warn(`[i18n] Missing namespace module: ${locale}/${ns}`)
    return
  }
  try {
    const mod = await modules[key]()
    const existing = i18n.global.getLocaleMessage(locale) || {}
    i18n.global.setLocaleMessage(locale, { ...existing, [ns]: mod.default || mod })
    set.add(ns)
    loaded.set(locale, set)
  } catch (err) {
    console.warn(`[i18n] Failed to load ${locale}/${ns}:`, err)
  }
}

export async function ensureNamespaces(namespaces = []) {
  const locale = i18n.global.locale.value
  await Promise.all(namespaces.map(ns => loadNamespace(locale, ns)))
}

export async function setLocale(locale, namespaces = []) {
  if (!isSupportedLocale(locale)) {
    console.warn(`[i18n] Unsupported locale: ${locale}`)
    return
  }
  for (const ns of namespaces) await loadNamespace(locale, ns)
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
  localStorage.setItem('locale', locale)
}

export function getLocale() {
  return i18n.global.locale.value
}

