<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { renderCatalogReadme } from '@/services/catalogReadme'

const props = defineProps<{ source: string }>()
const { t } = useI18n()
const rendered = computed(() => renderCatalogReadme(props.source))
</script>

<template>
  <div class="rounded-xl border border-base-300 bg-base-100 p-4 sm:p-6">
    <!-- v-html receives only the HTML-disabled, link-validated Markdown renderer. -->
    <div class="catalog-readme text-sm leading-7 break-words" data-testid="catalog-readme-preview" v-html="rendered" />
    <details class="mt-5 border-t border-base-300 pt-4" data-testid="catalog-readme-source">
      <summary class="cursor-pointer text-sm font-medium">{{ t('catalog.detail.readme_source') }}</summary>
      <pre tabindex="0" :aria-label="t('catalog.detail.readme_source')" class="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-6">{{ source }}</pre>
    </details>
  </div>
</template>

<style scoped>
.catalog-readme :deep(:first-child) { margin-top: 0; }
.catalog-readme :deep(h3), .catalog-readme :deep(h4), .catalog-readme :deep(h5), .catalog-readme :deep(h6) { margin: 1.5rem 0 0.75rem; font-weight: 600; line-height: 1.4; }
.catalog-readme :deep(h3) { font-size: 1.25rem; }
.catalog-readme :deep(h4) { font-size: 1.1rem; }
.catalog-readme :deep(p), .catalog-readme :deep(ul), .catalog-readme :deep(ol), .catalog-readme :deep(blockquote) { margin: 0.75rem 0; }
.catalog-readme :deep(ul), .catalog-readme :deep(ol) { padding-inline-start: 1.5rem; }
.catalog-readme :deep(ul) { list-style-type: disc; }
.catalog-readme :deep(ol) { list-style-type: decimal; }
.catalog-readme :deep(a) { text-decoration: underline; text-underline-offset: 3px; overflow-wrap: anywhere; }
.catalog-readme :deep(a:focus-visible) { outline: 2px solid currentColor; outline-offset: 3px; }
.catalog-readme :deep(blockquote) { border-inline-start: 3px solid var(--color-base-300); padding-inline-start: 1rem; }
.catalog-readme :deep(pre) { white-space: pre-wrap; overflow-wrap: anywhere; padding: 1rem; background: var(--color-base-200); border-radius: 0.5rem; }
.catalog-readme :deep(code) { font-family: var(--font-mono); font-size: 0.875em; }
.catalog-readme :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 1rem 0; }
.catalog-readme :deep(th), .catalog-readme :deep(td) { border: 1px solid var(--color-base-300); padding: 0.5rem 0.75rem; text-align: start; }
.catalog-readme :deep(hr) { margin: 1rem 0; border-color: var(--color-base-300); }
</style>
