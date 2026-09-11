<script setup>
import { computed } from 'vue'
import { inspectAttachment } from '@/services/attachmentMigration'

const props = defineProps({
  attachments: { type: Array, required: true }, nodes: { type: Array, required: true },
  files: { type: Object, default: () => ({}) }, choices: { type: Object, required: true },
})
const emit = defineEmits(['update:choices'])
const rows = computed(() => props.attachments.map(attachment => {
  try { return { attachment, kind: inspectAttachment(attachment, props.nodes, props.files).kind } }
  catch (error) { return { attachment, issue: error.message || String(error) } }
}))
function choose(id, key, value) {
  emit('update:choices', { ...props.choices, [id]: { ...props.choices[id], [key]: value } })
}
</script>

<template>
  <section data-testid="attachment-migration" class="border border-warning/50 rounded-lg p-3 my-4 min-w-0">
    <h3 class="font-semibold">Review legacy attachments</h3>
    <p class="text-sm my-2">Conversion adds supported main-stage content after the current Content list, sorted by its saved order. Task lists run on their target VM with privilege escalation. Original records are archived in a project file. Nothing changes until you review and apply the complete scenario.</p>
    <div v-for="(row, index) in rows" :key="index" class="border-t border-base-300 py-3 min-w-0" data-testid="migration-row">
      <p class="text-sm break-words"><strong>{{ row.attachment.title || row.attachment.id || 'Unnamed attachment' }}</strong> · {{ row.attachment.target_node }} · {{ row.attachment.stage || 'main' }} · order {{ row.attachment.order_in_stage ?? 0 }}</p>
      <p v-if="row.issue" class="text-sm text-error mt-1" data-testid="migration-issue">{{ row.issue }}. This attachment stays in the project; conversion cannot apply until every item is resolved.</p>
      <p v-else-if="row.kind" class="text-sm mt-1">Convert to {{ row.kind === 'tasks' ? 'a playbook importing the original task file' : 'a playbook' }}; preserve its bytes and variables.</p>
      <div v-else class="grid gap-2 sm:grid-cols-3 mt-2">
        <label class="form-control gap-1"><span>Uploaded content kind</span>
          <select :value="choices[row.attachment.id]?.kind || ''" class="select select-bordered w-full" data-testid="migration-kind"
            @change="choose(row.attachment.id, 'kind', $event.target.value)">
            <option value="" disabled>Choose how to use this file</option>
            <option value="file">Copy file to guest</option><option value="script">Run script</option>
            <option value="playbook">Ansible playbook</option><option value="tasks">Ansible task list</option>
          </select>
        </label>
        <template v-if="choices[row.attachment.id]?.kind === 'file'">
          <label class="form-control gap-1"><span>Guest destination</span><input class="input input-bordered w-full" data-testid="migration-destination"
            :value="choices[row.attachment.id]?.destination || ''" @input="choose(row.attachment.id, 'destination', $event.target.value)" placeholder="/etc/example.conf" /></label>
          <label class="form-control gap-1"><span>File mode</span><input class="input input-bordered w-full"
            :value="choices[row.attachment.id]?.mode || '0644'" @input="choose(row.attachment.id, 'mode', $event.target.value)" /></label>
        </template>
      </div>
    </div>
  </section>
</template>
