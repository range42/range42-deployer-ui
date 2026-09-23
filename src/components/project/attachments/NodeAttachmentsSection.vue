<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { removeAttachment } from '@/composables/useAttachments'
import AttachmentEditor from './AttachmentEditor.vue'

const props = defineProps({
  node: {
    type: Object,
    required: true,
  },
  attachments: {
    type: Array,
    default: () => [],
  },
  nodes: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['update:attachments', 'open-content'])

const { t } = useI18n()

const editingId = ref(null)

const nodeAttachments = computed(() =>
  props.attachments.filter((a) => a.target_node === props.node.id),
)

const editingAttachment = computed(() =>
  editingId.value ? props.attachments.find((a) => a.id === editingId.value) ?? null : null,
)

function onEditorUpdate(next) {
  emit('update:attachments', props.attachments.map((a) => (a.id === next.id ? next : a)))
}

function onEditorDelete() {
  emit('update:attachments', removeAttachment(props.attachments, editingId.value))
  editingId.value = null
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Attachment list -->
    <div
      v-if="nodeAttachments.length > 0"
      class="flex flex-col gap-1"
    >
      <button
        v-for="att in nodeAttachments"
        :key="att.id"
        :data-testid="`node-att-row-${att.id}`"
        type="button"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left hover:bg-base-200 transition-colors"
        :class="editingId === att.id ? 'bg-base-200 font-medium' : ''"
        @click="editingId = att.id"
      >
        <span class="badge badge-neutral badge-sm font-mono">{{ att.source.kind }}</span>
        <span class="truncate text-base-content/70">{{ att.title || att.id }}</span>
      </button>
    </div>

    <!-- Empty state -->
    <div
      v-else
      data-testid="node-att-empty"
      class="text-sm text-base-content/50 italic py-2"
    >
      {{ t('project.attachments.section.empty') }}
    </div>

    <p class="text-sm text-base-content/70">Add files, scripts, playbooks and verified bundles in Scenario Content. Existing attachments stay available here until you review their conversion.</p>
    <button data-testid="scenario-content-btn" type="button" class="btn btn-sm btn-primary"
      @click="emit('open-content', node.type === 'vm' ? node.id : '')">Open Scenario Content</button>

    <!-- Inline editor -->
    <AttachmentEditor
      v-if="editingAttachment"
      :attachment="editingAttachment"
      :nodes="nodes"
      @update:attachment="onEditorUpdate"
      @delete="onEditorDelete"
      @close="editingId = null"
    />
  </div>
</template>
