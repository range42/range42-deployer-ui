<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildCatalogRole, type CatalogRoleDraft } from '@/services/catalogRoleAuthoring'

const props = withDefaults(defineProps<{ open: boolean; existingPaths?: string[] }>(), { existingPaths: () => [] })
const emit = defineEmits<{ close: []; prepared: [draft: CatalogRoleDraft] }>()
const { t } = useI18n({ useScope: 'local', messages: {
  en: {
    title: 'New Ansible role', intro: 'Create a reusable role in your catalog, then choose where to publish it.',
    category: 'Category', action: 'Action', target: 'Target', description: 'Description', tags: 'Tags, separated by commas',
    naming: 'Role names follow category.action.target.', tasks: 'Ansible tasks', defaults: 'Default variables (optional)',
    taskHint: 'Enter a YAML list of tasks. Target hosts are selected by the scenario that calls this role.',
    preview: 'Preview files', files: 'Files to create', continue: 'Choose publication targets', close: 'Close',
    collision: 'Publication checks each destination for an existing role with this name.',
  },
  fr: {
    title: 'Nouveau rôle Ansible', intro: 'Créez un rôle réutilisable dans votre catalogue, puis choisissez où le publier.',
    category: 'Catégorie', action: 'Action', target: 'Cible', description: 'Description', tags: 'Étiquettes séparées par des virgules',
    naming: 'Les noms suivent catégorie.action.cible.', tasks: 'Tâches Ansible', defaults: 'Variables par défaut (facultatif)',
    taskHint: 'Saisissez une liste YAML de tâches. Le scénario qui appelle ce rôle sélectionne les hôtes cibles.',
    preview: 'Prévisualiser les fichiers', files: 'Fichiers à créer', continue: 'Choisir les destinations de publication', close: 'Fermer',
    collision: 'La publication vérifie que chaque destination ne contient pas déjà un rôle de ce nom.',
  },
  jp: {
    title: 'Ansible ロールを作成', intro: '再利用できるロールをカタログに作成し、公開先を選択します。',
    category: 'カテゴリ', action: '操作', target: '対象', description: '説明', tags: 'タグ（カンマ区切り）',
    naming: 'ロール名は category.action.target の形式です。', tasks: 'Ansible タスク', defaults: '既定の変数（任意）',
    taskHint: 'タスクの YAML リストを入力します。対象ホストはこのロールを呼び出すシナリオで選択します。',
    preview: 'ファイルを確認', files: '作成するファイル', continue: '公開先を選択', close: '閉じる',
    collision: '公開時に各公開先で同じ名前のロールが存在しないか確認します。',
  },
} })
const form = reactive({ category: 'software', action: 'install', target: '', description: '', tags: '', tasks: '', defaults: '' })
const draft = ref<CatalogRoleDraft | null>(null)
const error = ref('')
const dialog = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
const roleName = computed(() => [form.category, form.action, form.target || 'target'].join('.'))

watch(form, () => { draft.value = null; error.value = '' }, { flush: 'sync' })
watch(() => props.open, async (open) => {
  if (open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    dialog.value?.querySelector<HTMLInputElement>('[name="target"]')?.focus()
  } else {
    previousFocus?.focus()
  }
}, { immediate: true })

function preview() {
  try {
    draft.value = buildCatalogRole(form, props.existingPaths)
    error.value = ''
  } catch (err) {
    draft.value = null
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab') return
  const focusable = [...(dialog.value?.querySelectorAll<HTMLElement>('input, textarea, button, summary') || [])]
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
</script>

<template>
  <div v-if="open" ref="dialog" class="modal modal-open z-[110]" role="dialog" aria-modal="true" aria-labelledby="new-role-title" @keydown="keydown">
    <div class="modal-box max-w-4xl max-h-[90vh]">
      <h2 id="new-role-title" class="text-xl font-semibold">{{ t('title') }}</h2>
      <p class="text-sm text-base-content/70 mt-2">{{ t('intro') }}</p>
      <form class="mt-5 space-y-4" @submit.prevent="preview">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label v-for="field in (['category', 'action', 'target'] as const)" :key="field" class="form-control min-w-0">
            <span class="label label-text">{{ t(field) }}</span>
            <input v-if="field === 'target'" v-model="form.target" name="target" class="input input-bordered w-full" placeholder="example_service" autocomplete="off" />
            <input v-else v-model="form[field]" :name="field" class="input input-bordered w-full" autocomplete="off" />
          </label>
        </div>
        <p class="text-xs text-base-content/65">{{ t('naming') }} <code class="break-all">{{ roleName }}</code></p>
        <label class="form-control block">
          <span class="label label-text">{{ t('description') }}</span>
          <textarea v-model="form.description" name="description" class="textarea textarea-bordered w-full" rows="2" />
        </label>
        <label class="form-control block">
          <span class="label label-text">{{ t('tags') }}</span>
          <input v-model="form.tags" name="tags" class="input input-bordered w-full" placeholder="service, configuration" />
        </label>
        <label class="form-control block">
          <span class="label label-text">{{ t('tasks') }}</span>
          <textarea v-model="form.tasks" name="tasks" class="textarea textarea-bordered font-mono w-full" rows="7" spellcheck="false" placeholder="- name: Configure the service" aria-describedby="new-role-task-hint" />
          <span id="new-role-task-hint" class="text-xs text-base-content/65 mt-1">{{ t('taskHint') }}</span>
        </label>
        <label class="form-control block">
          <span class="label label-text">{{ t('defaults') }}</span>
          <textarea v-model="form.defaults" name="defaults" class="textarea textarea-bordered font-mono w-full" rows="3" spellcheck="false" placeholder="service_port: 8080" />
        </label>
        <p v-if="error" role="alert" class="text-sm text-error whitespace-pre-wrap">{{ error }}</p>
        <button type="submit" class="btn btn-outline btn-sm">{{ t('preview') }}</button>
      </form>

      <section v-if="draft" class="mt-6" aria-labelledby="new-role-files">
        <h3 id="new-role-files" class="font-semibold mb-2">{{ t('files') }}</h3>
        <details v-for="(content, path) in draft.files" :key="path" class="rounded-lg border border-base-300 mb-2" :open="path.endsWith('/tasks/main.yml')" data-testid="role-file-preview">
          <summary class="p-3 cursor-pointer font-mono text-xs break-all">{{ path }}</summary>
          <pre class="p-3 pt-0 overflow-x-auto text-xs"><code>{{ content }}</code></pre>
        </details>
        <p class="text-xs text-base-content/65">{{ t('collision') }}</p>
      </section>

      <div class="modal-action flex-wrap">
        <button type="button" class="btn btn-ghost" @click="emit('close')">{{ t('close') }}</button>
        <button v-if="draft" type="button" class="btn btn-primary" data-testid="role-continue" @click="emit('prepared', draft)">{{ t('continue') }}</button>
      </div>
    </div>
  </div>
</template>
