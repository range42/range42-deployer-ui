<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n'
import { getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { createSnapshotClient, SnapshotRequestError, type SnapshotSet, type RetentionReview } from '@/services/snapshotSets'

const props = defineProps<{ deploymentId: string; projectSha: string; hostId: string; disabled?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()
const backend = useBackendApiStore()
const items = ref<SnapshotSet[]>([]), reviews = ref<SnapshotSet[]>([])
const policy = ref<RetentionReview['policy'] | null>(null)
const busy = ref(false), error = ref(''), notice = ref('')
const name = ref('Checkpoint'), description = ref('')
const total = ref(0), offset = ref(0)
let version = 0
let client: ReturnType<typeof createSnapshotClient> | null = null
const active = computed(() => items.value.some(item => ['running', 'needs_review'].includes(item.operation.state)))
const canPlan = computed(() => !busy.value && !props.disabled && !active.value)
const compatible = (item: SnapshotSet) => item.project_sha === props.projectSha && item.host_id === props.hostId
const canExecute = (item: SnapshotSet) => canPlan.value && compatible(item) && item.operation.state === 'planned' && Date.parse(item.operation.expires_at) > Date.now()
const label = (value: string) => t(`snapshots.states.${value}`)
const kind = (value: string) => t(`snapshots.kinds.${value}`)
function upsert(item: SnapshotSet) {
  items.value = [item, ...items.value.filter(existing => existing.id !== item.id)]
  total.value = Math.max(total.value, items.value.length)
}
async function perform<T>(task: (api: ReturnType<typeof createSnapshotClient>) => Promise<T>, apply: (result: T) => void) {
  if (busy.value || !client) return
  const current = version, selected = client
  busy.value = true; error.value = ''; notice.value = ''
  try {
    selected.guard()
    const result = await task(selected)
    if (current !== version) return
    selected.guard(); apply(result)
  } catch (cause) {
    if (current === version) error.value = cause instanceof SnapshotRequestError ? cause.reason : 'unconfirmed'
  } finally {
    if (current === version) busy.value = false
  }
}
function refresh(nextOffset = offset.value) {
  reviews.value = []; policy.value = null
  return perform(api => api.list(nextOffset), result => { items.value = result.items; total.value = result.total; offset.value = result.offset })
}
function planCreate() {
  if (!canPlan.value || !name.value.trim()) return
  policy.value = null
  void perform(api => api.planCreate(name.value, description.value), result => { reviews.value = [result] })
}
function planExisting(item: SnapshotSet, operation: 'rollback' | 'delete') {
  if (!canPlan.value || !compatible(item)) return
  policy.value = null
  void perform(api => api.planExisting(item, operation), result => { reviews.value = [result] })
}
function planRetention() {
  if (!canPlan.value) return
  void perform(api => api.planRetention(), result => {
    policy.value = result.policy; reviews.value = result.candidates
    if (!result.candidates.length) notice.value = 'noCandidates'
  })
}
function execute(item: SnapshotSet) {
  if (!canExecute(item)) { error.value = 'stale'; return }
  // A submitted review is consumed locally even if its HTTP result is lost.
  // Other retention candidates need a fresh review after this operation ends.
  reviews.value = []; policy.value = null
  void perform(api => api.execute(item), result => { upsert(result); emit('changed') })
}
function reconcile(item: SnapshotSet) {
  void perform(api => api.reconcile(item), result => { upsert(result); emit('changed') })
}
function cancelPlans() {
  const captured = [...reviews.value]
  reviews.value = []; policy.value = null
  void perform(async api => { for (const item of captured) await api.cancel(item) }, () => { notice.value = 'cancelled' })
}
watch([() => props.deploymentId, () => props.projectSha, () => props.hostId, getBackendScope, () => backend.token, () => backend.activeHost?.id], () => {
  const current = ++version
  busy.value = false; items.value = []; reviews.value = []; policy.value = null; total.value = 0; offset.value = 0; error.value = ''; client = null
  try {
    client = createSnapshotClient({ deploymentId: props.deploymentId, projectSha: props.projectSha, hostId: props.hostId }, () => {
      if (version !== current) throw new SnapshotRequestError('context')
    })
    void refresh(0)
  } catch { error.value = 'context' }
}, { immediate: true, flush: 'sync' })
watch(() => props.disabled, disabled => { if (disabled) { reviews.value = []; policy.value = null } })
void ensureNamespaces(['snapshots'])
onBeforeUnmount(() => { version += 1; client = null })
</script>

<template>
  <section class="rounded-xl border border-base-300 bg-base-100 p-4 mb-4 space-y-4" aria-labelledby="snapshot-sets-heading" data-testid="snapshot-sets">
    <header class="flex flex-wrap justify-between gap-3">
      <div class="min-w-0"><h2 id="snapshot-sets-heading" class="font-semibold">{{ t('snapshots.title') }}</h2>
        <p class="text-sm mt-1">{{ t('snapshots.description') }}</p></div>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="refresh()">{{ t('snapshots.refresh') }}</button>
    </header>
    <p v-if="error" role="alert" class="alert alert-error text-sm break-words">{{ t(`snapshots.errors.${error}`) }}</p>
    <p v-if="notice" role="status" class="text-sm">{{ t(`snapshots.${notice}`) }}</p>
    <p v-if="busy" role="status" class="text-sm">{{ t('snapshots.working') }}</p>
    <p v-if="props.disabled || active" class="text-sm border-l-2 border-warning pl-2">{{ t('snapshots.busy') }}</p>
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="form-control"><span class="label-text">{{ t('snapshots.name') }}</span><input v-model="name" maxlength="128" class="input input-bordered w-full" :disabled="busy || !!reviews.length"></label>
      <label class="form-control"><span class="label-text">{{ t('snapshots.details') }}</span><input v-model="description" maxlength="1024" class="input input-bordered w-full" :disabled="busy || !!reviews.length"></label>
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-outline btn-sm" :disabled="!canPlan || !name.trim()" data-testid="snapshot-plan-create" @click="planCreate">{{ t('snapshots.planCreate') }}</button>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="!canPlan" data-testid="snapshot-plan-retention" @click="planRetention">{{ t('snapshots.retention') }}</button>
    </div>
    <div v-if="reviews.length" class="rounded-lg border border-info p-4 space-y-4" data-testid="snapshot-review">
      <h3 class="font-semibold">{{ t('snapshots.review') }}</h3>
      <p v-if="policy" class="text-sm">{{ t('snapshots.policy', { count: policy.keep_count, days: policy.keep_days }) }}</p>
      <article v-for="item in reviews" :key="item.operation.id" class="space-y-2">
        <h4 class="font-medium break-words">{{ kind(item.operation.kind) }} · {{ item.name }}</h4>
        <p class="text-sm">{{ t('snapshots.nonAtomic') }}</p>
        <p v-if="item.operation.kind === 'rollback'" class="text-sm font-medium">{{ t('snapshots.rollbackWarning') }}</p>
        <p v-if="item.operation.kind === 'delete'" class="text-sm font-medium">{{ t('snapshots.deleteWarning') }}</p>
        <p class="text-xs break-all">{{ t('snapshots.target') }}: {{ item.host_id }} · {{ item.project_sha }}</p>
        <ul class="text-sm space-y-1"><li v-for="vm in item.operation.reviewed_members" :key="vm.vm_id" class="break-words">{{ vm.vm_name }} · {{ vm.vm_id }} · {{ label(vm.status) }} <span class="font-mono text-xs">{{ vm.uuid }}</span></li></ul>
        <p class="text-xs">{{ t('snapshots.expires') }}: <time :datetime="item.operation.expires_at">{{ new Date(item.operation.expires_at).toLocaleString() }}</time></p>
        <button type="button" class="btn btn-primary btn-sm" :disabled="!canExecute(item)" data-testid="snapshot-confirm" @click="execute(item)">{{ t('snapshots.confirm', { action: kind(item.operation.kind) }) }}</button>
      </article>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" data-testid="snapshot-cancel-plan" @click="cancelPlans">{{ t('snapshots.cancelPlans') }}</button>
    </div>
    <p v-if="!busy && !items.length && !error" class="text-sm">{{ t('snapshots.empty') }}</p>
    <article v-for="item in items" :key="item.id" class="rounded-lg bg-base-200/60 p-3 space-y-2" data-testid="snapshot-record">
      <h3 class="font-medium break-words">{{ item.name }} · {{ label(item.state) }}</h3>
      <p class="text-sm">{{ kind(item.operation.kind) }} · {{ label(item.operation.state) }}</p>
      <p v-if="!compatible(item)" class="text-sm">{{ t('snapshots.oldBinding') }}</p>
      <p v-if="item.operation.recovery === 'operator_required'" class="text-sm border-l-2 border-warning pl-2">{{ t('snapshots.operatorRecovery') }}</p>
      <ul class="text-sm"><li v-for="vm in item.operation.members" :key="vm.vm_id">{{ vm.vm_id }} · {{ label(vm.state) }}</li></ul>
      <div class="flex flex-wrap gap-2">
        <button v-if="['running', 'needs_review'].includes(item.operation.state)" type="button" class="btn btn-outline btn-sm" :disabled="busy || !compatible(item)" data-testid="snapshot-reconcile" @click="reconcile(item)">{{ t('snapshots.reconcile') }}</button>
        <button v-if="item.state === 'complete'" type="button" class="btn btn-outline btn-sm" :disabled="!canPlan || !compatible(item)" data-testid="snapshot-plan-rollback" @click="planExisting(item, 'rollback')">{{ t('snapshots.planRollback') }}</button>
        <button v-if="['complete', 'partial', 'failed'].includes(item.state)" type="button" class="btn btn-ghost btn-sm" :disabled="!canPlan || !compatible(item)" data-testid="snapshot-plan-delete" @click="planExisting(item, 'delete')">{{ t('snapshots.planDelete') }}</button>
      </div>
    </article>
    <nav v-if="total > 20" class="flex flex-wrap gap-2" :aria-label="t('snapshots.pages')">
      <button type="button" class="btn btn-ghost btn-sm" :disabled="busy || offset === 0" @click="refresh(Math.max(0, offset - 20))">{{ t('snapshots.previous') }}</button>
      <span class="text-sm self-center">{{ offset + 1 }}–{{ Math.min(offset + 20, total) }} / {{ total }}</span>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="busy || offset + 20 >= total" @click="refresh(offset + 20)">{{ t('snapshots.next') }}</button>
    </nav>
  </section>
</template>
