<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import CatalogPickerForm from './sources/CatalogPickerForm.vue'
import InlineYamlForm from './sources/InlineYamlForm.vue'
import FileUploadForm from './sources/FileUploadForm.vue'
import ExternalGitForm from './sources/ExternalGitForm.vue'

const SOURCE_FORMS = {
  catalog_role: CatalogPickerForm,
  catalog_container: CatalogPickerForm,
  inline_yaml: InlineYamlForm,
  file_upload: FileUploadForm,
  external_git: ExternalGitForm,
}

const props = defineProps({
  attachment: {
    type: Object,
    required: true,
  },
  nodes: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['update:attachment', 'delete', 'close'])

const { t } = useI18n()

const isGroupTarget = computed(() => {
  const node = props.nodes.find((n) => n.id === props.attachment.target_node)
  return node?.type === 'group'
})

const sourceForm = computed(() => SOURCE_FORMS[props.attachment.source.kind] ?? null)

function patch(fields) {
  emit('update:attachment', { ...props.attachment, ...fields })
}

function onTitleInput(event) {
  patch({ title: event.target.value })
}

function onStageInput(event) {
  patch({ stage: event.target.value })
}

function onOrderInput(event) {
  patch({ order_in_stage: Number(event.target.value) })
}

function onScopeChange(event) {
  patch({ scope: event.target.value })
}

function onSourceUpdate(newSource) {
  emit('update:attachment', { ...props.attachment, source: newSource })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header row: kind badge + action buttons -->
    <div class="flex items-center justify-between gap-2">
      <span
        data-testid="att-kind"
        class="badge badge-neutral font-mono text-xs"
      >
        {{ attachment.source.kind }}
      </span>
      <div class="flex gap-1">
        <button
          data-testid="att-close"
          class="btn btn-ghost btn-sm"
          type="button"
          @click="emit('close')"
        >
          {{ t('project.attachments.editor.close') }}
        </button>
        <button
          data-testid="att-delete"
          class="btn btn-error btn-sm"
          type="button"
          @click="emit('delete')"
        >
          {{ t('project.attachments.editor.delete') }}
        </button>
      </div>
    </div>

    <!-- Common fields -->
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1">
        <span class="label text-sm">{{ t('project.attachments.editor.title') }}</span>
        <input
          data-testid="att-title"
          type="text"
          :aria-label="t('project.attachments.editor.title')"
          class="input input-bordered input-sm w-full"
          :value="attachment.title ?? ''"
          @input="onTitleInput"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="label text-sm">{{ t('project.attachments.editor.stage') }}</span>
        <input
          data-testid="att-stage"
          type="text"
          :aria-label="t('project.attachments.editor.stage')"
          class="input input-bordered input-sm w-full"
          :value="attachment.stage ?? ''"
          @input="onStageInput"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="label text-sm">{{ t('project.attachments.editor.order') }}</span>
        <input
          data-testid="att-order"
          type="number"
          :aria-label="t('project.attachments.editor.order')"
          class="input input-bordered input-sm w-full"
          :value="attachment.order_in_stage ?? ''"
          @input="onOrderInput"
        />
      </label>

      <label
        v-if="isGroupTarget"
        class="flex flex-col gap-1"
      >
        <span class="label text-sm">{{ t('project.attachments.editor.scope') }}</span>
        <select
          data-testid="att-scope"
          :aria-label="t('project.attachments.editor.scope')"
          class="select select-bordered select-sm w-full"
          :value="attachment.scope ?? 'node'"
          @change="onScopeChange"
        >
          <option value="node">node</option>
          <option value="group_inherited">group_inherited</option>
        </select>
      </label>
    </div>

    <!-- Per-kind source sub-form -->
    <component
      :is="sourceForm"
      v-if="sourceForm"
      :source="attachment.source"
      @update:source="onSourceUpdate"
    />
  </div>
</template>
