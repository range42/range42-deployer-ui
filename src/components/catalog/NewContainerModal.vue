<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'
import { buildCatalogContainer } from '@/services/catalogContainerAuthoring'
import type { CatalogRoleDraft } from '@/services/catalogRoleAuthoring'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; prepared: [draft: CatalogRoleDraft] }>()
const { t } = useI18n({ useScope: 'local', messages: {
  en: { title: 'New Compose workload', intro: 'Create a reusable workload to run inside a project VM.', target: 'Workload name', description: 'Description', tags: 'Tags, separated by commas', compose: 'Compose YAML', files: 'Additional text files (JSON path-to-content object)', secretNames: 'Secret placeholder names, separated by commas (optional)',
    hint: 'Use the supported Compose fields, include every local build or mount dependency, and enter only secret placeholder names. Bind those names to the backend vault when adding the workload to a project.', preview: 'Preview files', continue: 'Choose publication targets', close: 'Close' },
  fr: { title: 'Nouvelle application Compose', intro: 'Créez une application réutilisable à exécuter dans une VM du projet.', target: 'Nom de l’application', description: 'Description', tags: 'Étiquettes séparées par des virgules', compose: 'YAML Compose', files: 'Fichiers texte supplémentaires (objet JSON chemin-contenu)', secretNames: 'Noms des secrets, séparés par des virgules (facultatif)',
    hint: 'Utilisez les champs Compose pris en charge, incluez chaque dépendance locale et saisissez uniquement les noms des secrets. Associez ces noms au vault du backend lors de l’ajout au projet.', preview: 'Prévisualiser les fichiers', continue: 'Choisir les destinations de publication', close: 'Fermer' },
  jp: { title: 'Compose ワークロードを作成', intro: 'プロジェクトの VM 内で実行する再利用可能なワークロードを作成します。', target: 'ワークロード名', description: '説明', tags: 'タグ（カンマ区切り）', compose: 'Compose YAML', files: '追加テキストファイル（パスと内容の JSON オブジェクト）', secretNames: 'シークレットの参照名（任意、カンマ区切り）',
    hint: '対応する Compose フィールドを使い、ローカルの依存ファイルをすべて含めてください。シークレットは名前だけを入力し、プロジェクトへの追加時にバックエンドの vault に関連付けます。', preview: 'ファイルを確認', continue: '公開先を選択', close: '閉じる' },
} })
const form = reactive({ target: '', description: '', tags: '', compose: 'services:\n  web:\n    image: nginx:alpine\n    ports: ["8080:80"]\n', files: '{}', secretNames: '' })
const draft = ref<CatalogRoleDraft | null>(null), error = ref(''), heading = ref<HTMLElement | null>(null), focusReady = ref(false)
watch(form, () => { draft.value = null; error.value = '' }, { flush: 'sync' })
watch(() => props.open, async () => { focusReady.value = false; await nextTick(); focusReady.value = props.open }, { immediate: true })
function preview() {
  try { draft.value = buildCatalogContainer(form); error.value = '' }
  catch (cause) { draft.value = null; error.value = cause instanceof Error ? cause.message : String(cause) }
}
</script>

<template>
  <FocusTrap v-if="open" :active="focusReady" :fallback-focus="() => heading!" :escape-deactivates="false">
    <div class="modal modal-open z-[110] p-3" role="dialog" aria-modal="true" aria-labelledby="new-container-title" @keydown.esc.prevent="emit('close')">
      <div class="modal-box max-w-4xl max-h-[90vh]">
        <h2 id="new-container-title" ref="heading" tabindex="-1" class="text-xl font-semibold">{{ t('title') }}</h2>
        <p class="mt-2 text-sm text-base-content/70">{{ t('intro') }}</p>
        <form class="mt-5 space-y-4" @submit.prevent="preview">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label v-for="field in (['target', 'tags'] as const)" :key="field" class="block">
              <span class="label label-text">{{ t(field) }}</span><input v-model="form[field]" :name="field" class="input input-bordered w-full" autocomplete="off" />
            </label>
          </div>
          <label v-for="field in (['description', 'compose', 'files'] as const)" :key="field" class="block">
            <span class="label label-text">{{ t(field) }}</span>
            <textarea v-model="form[field]" :name="field" :rows="field === 'compose' ? 10 : 3" class="textarea textarea-bordered w-full" :class="{ 'font-mono text-xs': field !== 'description' }" spellcheck="false" />
          </label>
          <label class="block"><span class="label label-text">{{ t('secretNames') }}</span><input v-model="form.secretNames" name="secretNames" class="input input-bordered w-full" autocomplete="off" /></label>
          <p class="text-sm text-base-content/70">{{ t('hint') }}</p>
          <p v-if="error" class="text-error text-sm" role="alert">{{ error }}</p>
          <button type="submit" class="btn btn-outline btn-sm">{{ t('preview') }}</button>
        </form>
        <section v-if="draft" class="mt-5 space-y-2">
          <details v-for="(content, path) in draft.files" :key="path" class="border border-base-300 rounded-lg" data-testid="container-file-preview" :open="path.endsWith('/compose.yml')">
            <summary class="p-3 font-mono text-xs break-all cursor-pointer">{{ path }}</summary>
            <pre class="px-3 pb-3 text-xs overflow-x-auto"><code>{{ content }}</code></pre>
          </details>
        </section>
        <div class="modal-action flex-wrap">
          <button type="button" class="btn btn-ghost" @click="emit('close')">{{ t('close') }}</button>
          <button v-if="draft" type="button" class="btn btn-primary" data-testid="container-continue" @click="emit('prepared', draft)">{{ t('continue') }}</button>
        </div>
      </div>
    </div>
  </FocusTrap>
</template>
