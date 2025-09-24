export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'jp', label: '日本語' },
]

export const DEFAULT_LOCALE = 'en'

export function isSupportedLocale(code) {
  return SUPPORTED_LOCALES.some(l => l.code === code)
}

