<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'
import { buildCatalogMachine } from '@/services/catalogMachineAuthoring'
import type { CatalogRoleDraft } from '@/services/catalogRoleAuthoring'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; prepared: [draft: CatalogRoleDraft] }>()
const { t } = useI18n({ useScope: 'local', messages: {
  en: { title: 'New VM blueprint', intro: 'Define a reusable machine and its resource requirements.', category: 'Category', target: 'Target',
    description: 'Description', tags: 'Tags, separated by commas', os: 'Required operating system', cores: 'CPU cores', memory_mb: 'Memory (MiB)',
    disk_gb: 'Disk (GiB)', template_vmid: 'Suggested template VMID (optional)', storage: 'Suggested storage (optional)',
    portable: 'Leave template and storage blank for a portable public blueprint. Choose a template on the target host when configuring a project. Review the clone destination in Scenario: blank inherits template storage, while a selected pool receives new clones. Existing guest disks are not moved.',
    network: 'The blueprint includes a network link. Configure SDN and assign guest addresses in the project before deploying.',
    naming: 'Machines use category.clone.target.', preview: 'Preview files', continue: 'Choose publication targets', close: 'Close' },
  fr: { title: 'Nouveau modèle de machine virtuelle', intro: 'Définissez une machine réutilisable et ses ressources.', category: 'Catégorie', target: 'Cible',
    description: 'Description', tags: 'Étiquettes séparées par des virgules', os: 'Système d’exploitation requis', cores: 'Cœurs CPU', memory_mb: 'Mémoire (Mio)',
    disk_gb: 'Disque (Gio)', template_vmid: 'VMID du template suggéré (facultatif)', storage: 'Stockage suggéré (facultatif)',
    portable: 'Laissez le template et le stockage vides pour un modèle public portable. Choisissez un template sur l’hôte cible. Vérifiez la destination dans Scénario : un champ vide conserve le stockage du template, un pool choisi reçoit les nouveaux clones. Les disques des invités existants ne sont pas déplacés.',
    network: 'Le modèle inclut un lien réseau. Configurez le SDN et les adresses des invités dans le projet avant le déploiement.',
    naming: 'Les machines suivent catégorie.clone.cible.', preview: 'Prévisualiser les fichiers', continue: 'Choisir les destinations de publication', close: 'Fermer' },
  jp: { title: 'VM 定義を作成', intro: '再利用できるマシンと必要なリソースを定義します。', category: 'カテゴリ', target: '対象',
    description: '説明', tags: 'タグ（カンマ区切り）', os: '必要な OS', cores: 'CPU コア数', memory_mb: 'メモリ（MiB）',
    disk_gb: 'ディスク（GiB）', template_vmid: '推奨テンプレート VMID（任意）', storage: '推奨ストレージ（任意）',
    portable: '公開用の定義ではテンプレートとストレージを空欄にし、設定時に対象ホストのテンプレートを選択します。シナリオでクローン先を確認します。空欄はテンプレートのストレージを継承し、プールを選ぶと新しいクローンをそこに作成します。既存ゲストのディスクは移動しません。',
    network: 'ネットワークリンクを含みます。デプロイ前にプロジェクトで SDN とゲストのアドレスを設定してください。',
    naming: 'マシン名は category.clone.target の形式です。', preview: 'ファイルを確認', continue: '公開先を選択', close: '閉じる' },
} })
const form = reactive({ category: 'systems', target: '', description: '', tags: '', os: '', cores: 2,
  memory_mb: 2048, disk_gb: 20, template_vmid: '', storage: '' })
const draft = ref<CatalogRoleDraft | null>(null), error = ref(''), heading = ref<HTMLElement | null>(null), focusReady = ref(false)
const name = computed(() => `${form.category}.clone.${form.target || 'target'}`)
watch(form, () => { draft.value = null; error.value = '' }, { flush: 'sync' })
watch(() => props.open, async () => { focusReady.value = false; await nextTick(); focusReady.value = props.open }, { immediate: true })
function preview() {
  try { draft.value = buildCatalogMachine(form); error.value = '' }
  catch (cause) { draft.value = null; error.value = cause instanceof Error ? cause.message : String(cause) }
}
</script>

<template>
  <FocusTrap v-if="open" :active="focusReady" fallback-focus="#new-machine-title" :escape-deactivates="false">
    <div class="modal modal-open z-[110] p-3" role="dialog" aria-modal="true" aria-labelledby="new-machine-title" @keydown.esc.prevent="emit('close')">
      <div class="modal-box max-w-3xl max-h-[90vh]">
        <h2 id="new-machine-title" ref="heading" tabindex="-1" class="text-xl font-semibold">{{ t('title') }}</h2>
        <p class="mt-2 text-sm text-base-content/70">{{ t('intro') }}</p>
        <form class="mt-5 space-y-4" @submit.prevent="preview">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label v-for="field in (['category', 'target'] as const)" :key="field" class="block">
              <span class="label label-text">{{ t(field) }}</span>
              <input v-model="form[field]" :name="field" class="input input-bordered w-full" autocomplete="off" />
            </label>
          </div>
          <p class="text-xs text-base-content/65">{{ t('naming') }} <code>{{ name }}</code></p>
          <label class="block"><span class="label label-text">{{ t('description') }}</span>
            <textarea v-model="form.description" name="description" class="textarea textarea-bordered w-full" rows="2" />
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label v-for="field in (['os', 'tags'] as const)" :key="field" class="block">
              <span class="label label-text">{{ t(field) }}</span><input v-model="form[field]" :name="field" class="input input-bordered w-full" />
            </label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label v-for="field in (['cores', 'memory_mb', 'disk_gb'] as const)" :key="field" class="block">
              <span class="label label-text">{{ t(field) }}</span><input v-model="form[field]" :name="field" type="number" min="1" step="1" class="input input-bordered w-full" />
            </label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label v-for="field in (['template_vmid', 'storage'] as const)" :key="field" class="block">
              <span class="label label-text">{{ t(field) }}</span><input v-model="form[field]" :name="field" class="input input-bordered w-full" autocomplete="off" />
            </label>
          </div>
          <p class="text-sm text-base-content/70">{{ t('portable') }}</p>
          <p class="text-sm text-base-content/70">{{ t('network') }}</p>
          <p v-if="error" class="text-error text-sm" role="alert">{{ error }}</p>
          <button type="submit" class="btn btn-outline btn-sm">{{ t('preview') }}</button>
        </form>
        <section v-if="draft" class="mt-5 space-y-2">
          <details v-for="(content, path) in draft.files" :key="path" class="border border-base-300 rounded-lg" data-testid="machine-file-preview" :open="path.endsWith('/range42.yaml')">
            <summary class="p-3 font-mono text-xs break-all cursor-pointer">{{ path }}</summary>
            <pre class="px-3 pb-3 text-xs overflow-x-auto"><code>{{ content }}</code></pre>
          </details>
        </section>
        <div class="modal-action flex-wrap">
          <button type="button" class="btn btn-ghost" @click="emit('close')">{{ t('close') }}</button>
          <button v-if="draft" type="button" class="btn btn-primary" data-testid="machine-continue" @click="emit('prepared', draft)">{{ t('continue') }}</button>
        </div>
      </div>
    </div>
  </FocusTrap>
</template>
