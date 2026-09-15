<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
defineProps({ node: { type: Object, required: true }, statusView: { type: Object, required: true }, statusDotClass: { type: String, default: '' } })
const emit = defineEmits(['action', 'revert-field', 'update-desired'])
</script>

<template>
  <!-- Live status + metrics card -->
  <div class="space-y-3 rounded-box bg-base-200/40 p-4">
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium uppercase tracking-wide opacity-60">
        {{ t('configPanel.liveStatus') }}
      </span>
      <span class="ml-auto inline-flex items-center gap-1.5 text-sm font-medium capitalize">
        <span
          class="h-2.5 w-2.5 rounded-full"
          :class="[statusDotClass, { 'animate-pulse': statusView.pulse }]"
        ></span>
        {{ statusView.label }}
      </span>
    </div>

    <div v-if="node.data.liveMetrics" class="grid grid-cols-2 gap-2">
      <div class="rounded-lg bg-base-100 px-3 py-2">
        <div class="text-[10px] uppercase tracking-wide opacity-50">{{ t('configPanel.metrics.cpu') }}</div>
        <div class="text-sm font-semibold tabular-nums">{{ Math.round(node.data.liveMetrics.cpu) }}%</div>
      </div>
      <div class="rounded-lg bg-base-100 px-3 py-2">
        <div class="text-[10px] uppercase tracking-wide opacity-50">{{ t('configPanel.metrics.ram') }}</div>
        <div class="text-sm font-semibold tabular-nums">{{ node.data.liveMetrics.memPercent }}%</div>
      </div>
    </div>

    <!-- Lifecycle actions — gated by live status so we never offer an
         action that doesn't apply (e.g. Start on a running VM). -->
    <div class="space-y-1.5">
      <span class="text-xs font-medium uppercase tracking-wide opacity-60">
        {{ t('configPanel.power.label') }}
      </span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-if="node.data.status !== 'running' && node.data.status !== 'paused'"
          class="btn btn-success btn-sm gap-1.5"
          :disabled="!!node.data.pendingAction"
          @click="emit('action', 'start')"
        >
          <span v-if="node.data.pendingAction === 'start'" class="loading loading-xs"></span>
          <svg v-else class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          {{ t('configPanel.lifecycle.start') }}
        </button>
        <button
          v-if="node.data.status === 'paused'"
          class="btn btn-success btn-sm gap-1.5"
          :disabled="!!node.data.pendingAction"
          @click="emit('action', 'resume')"
        >
          <span v-if="node.data.pendingAction === 'resume'" class="loading loading-xs"></span>
          <svg v-else class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          {{ t('configPanel.lifecycle.resume') }}
        </button>
        <button
          v-if="node.data.status === 'running'"
          class="btn btn-info btn-sm gap-1.5"
          :disabled="!!node.data.pendingAction"
          @click="emit('action', 'pause')"
        >
          <span v-if="node.data.pendingAction === 'pause'" class="loading loading-xs"></span>
          <svg v-else class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
          </svg>
          {{ t('configPanel.lifecycle.pause') }}
        </button>
        <button
          v-if="node.data.status === 'running' || node.data.status === 'paused'"
          class="btn btn-warning btn-sm gap-1.5"
          :disabled="!!node.data.pendingAction"
          @click="emit('action', 'stop')"
        >
          <span v-if="node.data.pendingAction === 'stop'" class="loading loading-xs"></span>
          <svg v-else class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h12v12H6z" />
          </svg>
          {{ t('configPanel.lifecycle.stop') }}
        </button>
      </div>
    </div>
  </div>

  <!-- Editable config fields (with diff/revert affordance) -->
  <div class="space-y-4">
    <!-- Name -->
    <div class="form-control">
      <div class="label pb-1">
        <span class="label-text font-medium">{{ t('configPanel.deployedFields.name') }}</span>
        <button
          v-if="node.data.desiredConfig?.name !== node.data.actualConfig?.name"
          class="btn btn-ghost btn-xs text-warning"
          :aria-label="t('configPanel.a11y.revertField', { field: t('configPanel.deployedFields.name') })"
          @click="emit('revert-field', 'name')"
        >&#x21A9;</button>
      </div>
      <input
        type="text"
        class="input input-bordered input-sm w-full rounded-lg"
        :class="{ 'border-warning': node.data.desiredConfig?.name !== node.data.actualConfig?.name }"
        :value="node.data.desiredConfig?.name || ''"
        @input="emit('update-desired', 'name', $event.target.value)"
      />
    </div>

    <!-- CPU Cores -->
    <div class="form-control">
      <div class="label pb-1">
        <span class="label-text font-medium">{{ t('configPanel.deployedFields.cores') }}</span>
        <button
          v-if="node.data.desiredConfig?.cores !== node.data.actualConfig?.cores"
          class="btn btn-ghost btn-xs text-warning"
          :aria-label="t('configPanel.a11y.revertField', { field: t('configPanel.deployedFields.cores') })"
          @click="emit('revert-field', 'cores')"
        >&#x21A9;</button>
      </div>
      <input
        type="number"
        min="1"
        max="128"
        class="input input-bordered input-sm w-full rounded-lg"
        :class="{ 'border-warning': node.data.desiredConfig?.cores !== node.data.actualConfig?.cores }"
        :value="node.data.desiredConfig?.cores || 1"
        @input="emit('update-desired', 'cores', Number($event.target.value))"
      />
    </div>

    <!-- Memory -->
    <div class="form-control">
      <div class="label pb-1">
        <span class="label-text font-medium">{{ t('configPanel.deployedFields.memory') }}</span>
        <button
          v-if="node.data.desiredConfig?.memory !== node.data.actualConfig?.memory"
          class="btn btn-ghost btn-xs text-warning"
          :aria-label="t('configPanel.a11y.revertField', { field: t('configPanel.deployedFields.memory') })"
          @click="emit('revert-field', 'memory')"
        >&#x21A9;</button>
      </div>
      <input
        type="number"
        min="128"
        step="256"
        class="input input-bordered input-sm w-full rounded-lg"
        :class="{ 'border-warning': node.data.desiredConfig?.memory !== node.data.actualConfig?.memory }"
        :value="node.data.desiredConfig?.memory || 0"
        @input="emit('update-desired', 'memory', Number($event.target.value))"
      />
    </div>

    <!-- Description -->
    <div class="form-control">
      <div class="label pb-1">
        <span class="label-text font-medium">{{ t('configPanel.deployedFields.description') }}</span>
        <button
          v-if="(node.data.desiredConfig?.description || '') !== (node.data.actualConfig?.description || '')"
          class="btn btn-ghost btn-xs text-warning"
          :aria-label="t('configPanel.a11y.revertField', { field: t('configPanel.deployedFields.description') })"
          @click="emit('revert-field', 'description')"
        >&#x21A9;</button>
      </div>
      <textarea
        class="textarea textarea-bordered textarea-sm w-full rounded-lg"
        :class="{ 'border-warning': (node.data.desiredConfig?.description || '') !== (node.data.actualConfig?.description || '') }"
        rows="2"
        :value="node.data.desiredConfig?.description || ''"
        @input="emit('update-desired', 'description', $event.target.value)"
      ></textarea>
    </div>
  </div>
</template>
