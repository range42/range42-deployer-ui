<script setup>
/**
 * Attachment manager — table of attachments with multi-select + bulk-edit.
 * - Multi-selection via per-row checkboxes (+ header select-all)
 * - Bulk actions toolbar: Set stage, Set order, Add vars, Delete
 * - When any selected attachment belongs to a GroupNode, an extra action is
 *   offered: "Attach at group (inherited by descendants)" — toggles
 *   `scope: 'group_inherited'` on those rows.
 * - Emits `update:attachments` with the new attachments array so the parent
 *   project store can persist.
 */
import { computed, ref } from 'vue'
import { applyBulkAttachmentEdit } from '@/composables/useInfraBuilder'

const props = defineProps({
  attachments: { type: Array, default: () => [] },
  nodes: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:attachments'])

const selected = ref(new Set())
const bulk = ref({
  stage: '',
  order: '',
  varsKey: '',
  varsValue: '',
})

const allSelected = computed({
  get: () => props.attachments.length > 0 && selected.value.size === props.attachments.length,
  set: (v) => {
    if (v) {
      selected.value = new Set(props.attachments.map((a) => a.id))
    } else {
      selected.value = new Set()
    }
  },
})

function toggleRow(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  selected.value = next
}

const selectionIntersectsGroup = computed(() => {
  if (!selected.value.size) return false
  const groupIds = new Set(
    (props.nodes || []).filter((n) => n.type === 'group').map((n) => n.id),
  )
  for (const a of props.attachments) {
    if (!selected.value.has(a.id)) continue
    if (a.node_id && groupIds.has(a.node_id)) return true
  }
  return false
})

function commit(next) {
  selected.value = new Set()
  emit('update:attachments', next)
}

function applyStage() {
  if (!bulk.value.stage) return
  commit(applyBulkAttachmentEdit(props.attachments, [...selected.value], { setStage: bulk.value.stage }))
  bulk.value.stage = ''
}

function applyOrder() {
  if (bulk.value.order === '' || bulk.value.order === null) return
  commit(applyBulkAttachmentEdit(props.attachments, [...selected.value], { setOrder: bulk.value.order }))
  bulk.value.order = ''
}

function applyVars() {
  const key = (bulk.value.varsKey || '').trim()
  if (!key) return
  commit(applyBulkAttachmentEdit(
    props.attachments,
    [...selected.value],
    { addVars: { [key]: bulk.value.varsValue } },
  ))
  bulk.value.varsKey = ''
  bulk.value.varsValue = ''
}

function applyDelete() {
  if (!selected.value.size) return
  commit(applyBulkAttachmentEdit(props.attachments, [...selected.value], { delete: true }))
}

function applyGroupInherited() {
  if (!selectionIntersectsGroup.value) return
  commit(applyBulkAttachmentEdit(
    props.attachments,
    [...selected.value],
    { setScope: 'group_inherited' },
  ))
}

function applyNodeScoped() {
  if (!selected.value.size) return
  commit(applyBulkAttachmentEdit(
    props.attachments,
    [...selected.value],
    { setScope: 'node' },
  ))
}
</script>

<template>
  <section class="attachment-manager bg-base-100 border border-base-300 rounded-lg" data-testid="attachment-manager">
    <header class="flex items-center justify-between px-3 py-2 border-b border-base-300">
      <h3 class="font-semibold text-sm">Attachments</h3>
      <span class="text-xs opacity-60">{{ selected.size }} selected / {{ attachments.length }}</span>
    </header>

    <!-- Bulk actions toolbar -->
    <div v-if="selected.size" class="px-3 py-2 border-b border-base-300 flex flex-wrap items-center gap-2" data-testid="bulk-toolbar">
      <div class="join">
        <input
          v-model="bulk.stage"
          class="input input-xs input-bordered join-item"
          placeholder="stage"
          data-testid="bulk-stage-input"
        />
        <button class="btn btn-xs join-item" @click="applyStage" data-testid="bulk-set-stage">Set stage</button>
      </div>
      <div class="join">
        <input
          v-model.number="bulk.order"
          type="number"
          class="input input-xs input-bordered join-item w-20"
          placeholder="order"
          data-testid="bulk-order-input"
        />
        <button class="btn btn-xs join-item" @click="applyOrder" data-testid="bulk-set-order">Set order</button>
      </div>
      <div class="join">
        <input v-model="bulk.varsKey" class="input input-xs input-bordered join-item" placeholder="var key" data-testid="bulk-var-key" />
        <input v-model="bulk.varsValue" class="input input-xs input-bordered join-item" placeholder="value" data-testid="bulk-var-value" />
        <button class="btn btn-xs join-item" @click="applyVars" data-testid="bulk-add-vars">Add var</button>
      </div>
      <button
        v-if="selectionIntersectsGroup"
        class="btn btn-xs btn-outline"
        data-testid="bulk-inherit"
        @click="applyGroupInherited"
      >
        Attach at group (inherited)
      </button>
      <button class="btn btn-xs btn-ghost" data-testid="bulk-node-scope" @click="applyNodeScoped">Scope: node</button>
      <button class="btn btn-xs btn-error ml-auto" data-testid="bulk-delete" @click="applyDelete">Delete</button>
    </div>

    <table class="table table-xs">
      <thead>
        <tr>
          <th class="w-8">
            <input type="checkbox" class="checkbox checkbox-xs" :checked="allSelected" @change="allSelected = $event.target.checked" data-testid="select-all" />
          </th>
          <th>Id</th>
          <th>Node</th>
          <th>Stage</th>
          <th>Order</th>
          <th>Scope</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in attachments" :key="a.id" :data-testid="`attachment-row-${a.id}`" :class="{ 'bg-primary/5': selected.has(a.id) }">
          <td>
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              :checked="selected.has(a.id)"
              @change="toggleRow(a.id)"
              :data-testid="`select-${a.id}`"
            />
          </td>
          <td class="font-mono text-xs">{{ a.id }}</td>
          <td class="font-mono text-xs">{{ a.node_id }}</td>
          <td>{{ a.stage || '—' }}</td>
          <td>{{ a.order ?? '—' }}</td>
          <td>
            <span class="badge badge-xs" :class="a.scope === 'group_inherited' ? 'badge-accent' : 'badge-ghost'">
              {{ a.scope || 'node' }}
            </span>
          </td>
        </tr>
        <tr v-if="!attachments.length">
          <td colspan="6" class="text-center text-xs opacity-60 py-4">No attachments yet.</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
