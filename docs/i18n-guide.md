# Internationalization (i18n) Guide

This project uses `vue-i18n` with lazy‑loaded namespaces. Translations live in `src/locales/<locale>/<namespace>.json` and are loaded on demand via helpers in `src/i18n/index.js`.

Key files:
- `src/i18n/index.js` – initializes i18n, lazy-loads namespaces with `ensureNamespaces()` and switches locales with `setLocale()`.
- `src/i18n/supported.js` – declares `SUPPORTED_LOCALES` and `DEFAULT_LOCALE`.
- `src/main.js` – installs i18n and preloads the `common` namespace before mounting.

Current locales and namespaces:
- `en`: `common.json`, `sidebar.json`
- `fr`: `common.json`, `sidebar.json`

Note: By default, namespaces must be top-level JSON files per locale (e.g., `src/locales/en/sidebar.json`). Nested paths like `nodes/sidebar.json` are not resolved unless you customize `resolveModuleKey()` in `src/i18n/index.js`.


## Add a New Language

1) Add the language to the supported list
- Edit `src/i18n/supported.js` and append to `SUPPORTED_LOCALES`:
```js
export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' } // <- example
]
```

2) Create the locale directory and required namespace files
- Create `src/locales/<code>/common.json` and any other namespaces used by your views/components (e.g., `sidebar.json`). Example structure:
```
src/locales/
  en/
    common.json
    sidebar.json
  fr/
    common.json
    sidebar.json
  es/
    common.json
    sidebar.json
```

3) Translate the keys
- Use the same keys across languages. Example `src/locales/es/sidebar.json`:
```json
{
  "title": "Range42",
  "subtitle": "Constructor de infraestructura de Cyber Range",
  "currentProject": "Proyecto actual",
  "untitledProject": "Proyecto sin título",
  "componentsCount": "{count} componentes",
  "infrastructure.title": "Componentes de infraestructura",
  "statusLegend.title": "Leyenda de estados",
  "statusLegend.incomplete": "Configuración incompleta",
  "statusLegend.ready": "Listo para desplegar",
  "statusLegend.deployedRunning": "Desplegado y en ejecución",
  "statusLegend.error": "Error / Fallido",
  "quickActions.title": "Acciones rápidas",
  "quickActions.export": "Exportar topología",
  "quickActions.deploySoon": "Desplegar infraestructura (pronto)",
  "quickActions.validateSoon": "Validar configuración (pronto)",
  "language.label": "Idioma"
}
```

4) Verify the language switcher
- The `Sidebar` language switcher already uses `SUPPORTED_LOCALES`. Switching will call `setLocale()` and lazy-load required namespaces.


## Add a New Component and Translate It

When you add UI with new strings, create a new namespace JSON file (or reuse an existing one) and load it where needed.

1) Create a namespace file
- For a new component (e.g., `ExportModal.vue`), create:
  - `src/locales/en/export.json`
  - `src/locales/fr/export.json`
  - (and other locales as needed)

2) Reference strings with `t()` in the component
- Import i18n and ensure the namespace is loaded, then use `t('export.key')`:
```vue
<script setup>
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'

const { t } = useI18n({ useScope: 'global' })

onMounted(() => {
  ensureNamespaces(['export', 'common'])
})
</script>

<template>
  <h3>{{ t('export.title') }}</h3>
  <button class="btn btn-primary">{{ t('common.save') }}</button>
</template>
```

3) Define the keys in each locale
- Example `src/locales/en/export.json`:
```json
{
  "title": "Export Topology",
  "cta": "Generate Topology JSON",
  "download": "Download topology.json",
  "emptyProject.title": "Empty Project",
  "emptyProject.desc": "Your project contains no components to export.",
  "errors.title": "Export Errors"
}
```
- Provide corresponding translations in `fr/export.json`, etc.

4) Avoid duplicating counts/numbers
- Prefer a single translated string with placeholders, e.g.:
```vue
<span>{{ t('sidebar.componentsCount', { count }) }}</span>
```
…instead of concatenating the number twice.


## Translating Existing Components

- `Sidebar.vue` already uses `sidebar` and `common` namespaces.
- `ConfigPanel.vue` and `ExportModal.vue` currently contain hard-coded English strings. To translate:
  1. Create namespaces (e.g., `configPanel.json`, `export.json`) for each locale.
  2. Load them with `ensureNamespaces(['configPanel', 'common'])` or similar in `onMounted()`.
  3. Replace hard-coded text with `t('configPanel.someKey')`.

Tip: Group related strings per view/component into a dedicated namespace to keep files manageable.


## Pluralization and Interpolation

- Use placeholders for dynamic values: `{count}` in JSON, then pass `{ count }` from code.
- For advanced pluralization, you can leverage vue-i18n’s pluralization rules in your locale strings.


## Testing Your Translations

- Switch language in the sidebar and verify strings update without a page reload.
- Open DevTools Console to see warnings from `src/i18n/index.js` if a namespace file is missing.
- Ensure all keys exist across locales to avoid fallback inconsistencies.


## Notes on Namespaces and Structure

- The loader in `src/i18n/index.js` resolves keys like `../locales/${locale}/${ns}.json`.
- Keep namespace files flat (no subfolders) unless you also update `resolveModuleKey()` accordingly.
- Preload commonly used namespaces in `src/main.js` or per-view via `ensureNamespaces()` to avoid first-render flashes.

## Reference Snippets

- Load namespaces on a page/component:
```ts
import { onMounted } from 'vue'
import { ensureNamespaces } from '@/i18n/index.js'

onMounted(() => ensureNamespaces(['sidebar', 'common']))
```

- Switch locale programmatically:
```ts
import { setLocale } from '@/i18n/index.js'

await setLocale('fr', ['sidebar', 'common'])
```

- Access global translator:
```ts
import { useI18n } from 'vue-i18n'
const { t } = useI18n({ useScope: 'global' })
```
