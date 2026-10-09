<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { reviewCatalogWorkload } from '@/services/catalogWorkload'

type Input = Parameters<typeof reviewCatalogWorkload>[0]
type Project = Input['project'] & { scenario?: Record<string, unknown> & { label?: string } }
const props = defineProps<{ project: Project; path: string }>()
const emit = defineEmits<{ apply: [{ projectId: string; files: Awaited<ReturnType<typeof reviewCatalogWorkload>>['files']; scenario: Awaited<ReturnType<typeof reviewCatalogWorkload>>['scenario'] }] }>()
const { t } = useI18n({ useScope: 'local', messages: {
  en: { title: 'Application workload', help: 'Edit and save application files under payload/, then review the updated workload. Use Scenario to select deployment or cleanup. Save the project and run Configure on the existing deployment to apply it.', review: 'Review application changes', apply: 'Use reviewed application files', images: 'Images', ports: 'Published ports', assets: 'Custom assets', none: 'None', changed: 'The project changed. Review the application again.', ready: 'The updated application files are ready to save.', busy: 'Reviewing application…' },
  fr: { title: 'Application', help: 'Modifiez et enregistrez les fichiers dans payload/, puis vérifiez l’application. Dans Scénario, choisissez le déploiement ou le nettoyage. Enregistrez le projet et lancez Configurer sur le déploiement existant pour appliquer les changements.', review: 'Vérifier les changements', apply: 'Utiliser les fichiers vérifiés', images: 'Images', ports: 'Ports publiés', assets: 'Ressources personnalisées', none: 'Aucun', changed: 'Le projet a changé. Vérifiez à nouveau l’application.', ready: 'Les fichiers de l’application sont prêts à être enregistrés.', busy: 'Vérification de l’application…' },
  jp: { title: 'アプリケーション', help: 'payload/ 内のファイルを編集・保存してから、変更を確認してください。シナリオでデプロイまたはクリーンアップを選択し、プロジェクトを保存して既存のデプロイで構成を実行すると適用されます。', review: 'アプリケーションの変更を確認', apply: '確認したファイルを使用', images: 'イメージ', ports: '公開ポート', assets: 'カスタム素材', none: 'なし', changed: 'プロジェクトが変更されました。もう一度確認してください。', ready: '更新したファイルを保存できます。', busy: 'アプリケーションを確認中…' },
} })
const selected = computed(() => (Array.isArray(props.project.scenario?.content) ? props.project.scenario.content : []).find((item: { id: string; kind: string; path: string }) => item.kind === 'playbook'
  && ['deploy.yml', 'cleanup.yml'].some(name => item.path === `content/workloads/${item.id}/${name}`)
  && props.path.startsWith(`scenarios/${props.project.scenario?.label}/content/workloads/${item.id}/`)))
const preview = ref<Awaited<ReturnType<typeof reviewCatalogWorkload>>>()
const error = ref(''), status = ref(''), busy = ref(false)
const identity = computed(() => JSON.stringify([props.project.id, props.project.files, props.project.scenario,
  props.project.nodes?.map(node => [node.id, node.type]), props.project.baseDoc?.env, props.path]))
let epoch = 0
watch(identity, () => {
  const hadReview = !!preview.value || busy.value
  epoch++; preview.value = undefined; busy.value = false; status.value = ''
  error.value = hadReview ? t('changed') : ''
}, { flush: 'sync' })
async function review() {
  if (!selected.value || busy.value) return
  const current = ++epoch
  busy.value = true; preview.value = undefined; error.value = ''; status.value = ''
  try {
    const result = await reviewCatalogWorkload(JSON.parse(JSON.stringify({ project: props.project, scenario: props.project.scenario, attachmentId: selected.value.id })))
    if (current === epoch) preview.value = result
  } catch (reason) { if (current === epoch) error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { if (current === epoch) busy.value = false }
}
function apply() {
  if (!preview.value || !selected.value) return
  const result = preview.value
  preview.value = undefined
  emit('apply', { projectId: props.project.id, files: result.files, scenario: result.scenario })
  status.value = t('ready')
}
</script>

<template>
  <section v-if="selected" class="border-b border-base-300 p-3 space-y-2 max-h-72 overflow-y-auto shrink-0" data-testid="workload-review-panel" aria-labelledby="workload-review-title">
    <h3 id="workload-review-title" class="font-semibold">{{ t('title') }} · {{ selected.id }}</h3>
    <p class="text-sm text-base-content/75">{{ t('help') }}</p>
    <button type="button" class="btn btn-outline btn-sm" data-testid="workload-review" :disabled="busy" @click="review">{{ t('review') }}</button>
    <div v-if="preview" class="space-y-2 text-sm" data-testid="workload-review-summary">
      <dl class="grid gap-1 sm:grid-cols-[8rem_1fr]">
        <dt>{{ t('images') }}</dt><dd class="break-all">{{ preview.summary.images.join(', ') }}</dd>
        <dt>{{ t('ports') }}</dt><dd>{{ preview.summary.published_ports.join(', ') || t('none') }}</dd>
        <dt>{{ t('assets') }}</dt><dd><ul><li v-for="asset in preview.summary.assets" :key="asset.path" class="break-all">{{ asset.path }} · {{ asset.size }} bytes</li></ul><span v-if="!preview.summary.assets.length">{{ t('none') }}</span></dd>
      </dl>
      <p>{{ preview.summary.readiness }}</p>
      <button type="button" class="btn btn-primary btn-sm" data-testid="workload-review-apply" @click="apply">{{ t('apply') }}</button>
    </div>
    <p v-if="error" role="alert" class="text-error text-sm">{{ error }}</p>
    <p v-if="busy || status" role="status" class="text-sm">{{ busy ? t('busy') : status }}</p>
  </section>
</template>
