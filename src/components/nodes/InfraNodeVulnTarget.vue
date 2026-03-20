<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps(['data', 'selected'])

const statusColor = computed(() => {
  switch (props.data.status) {
    case 'gray': return 'bg-gray-400'
    case 'orange': return 'bg-orange-400'
    case 'green': return 'bg-green-400'
    case 'red': return 'bg-red-400'
    default: return 'bg-gray-400'
  }
})

const difficultyBadge = computed(() => {
  const level = props.data.config?.difficulty || 'medium'
  switch (level) {
    case 'easy': return { class: 'bg-green-500', label: 'Easy' }
    case 'medium': return { class: 'bg-yellow-500', label: 'Medium' }
    case 'hard': return { class: 'bg-red-500', label: 'Hard' }
    case 'insane': return { class: 'bg-purple-500', label: 'Insane' }
    default: return { class: 'bg-yellow-500', label: 'Medium' }
  }
})
</script>

<template>
  <div
    class="rounded-lg shadow-md p-3 min-w-[180px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 dark:from-red-950/40 dark:via-orange-950/30 dark:to-yellow-950/30': true,
      'border-red-400 shadow-lg shadow-red-200/50 dark:shadow-red-900/30': selected,
      'border-red-200 dark:border-red-900 hover:border-red-300 dark:hover:border-red-800': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <AppIcon name="target" class="w-5 h-5" />
      </div>
      <div class="flex items-center gap-1">
        <div :class="`w-2 h-2 rounded-full ${difficultyBadge.class}`"></div>
        <div class="text-xs bg-red-600/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
          Target
        </div>
      </div>
    </div>

    <!-- Node Content -->
    <div class="space-y-1">
      <div class="font-semibold text-sm text-red-900 dark:text-red-100">
        {{ data.config?.name || 'Vulnerable Target' }}
      </div>
      <div class="text-xs text-red-700/80 dark:text-red-300/70 space-y-0.5">
        <div v-if="data.config?.template" class="flex items-center gap-1">
          <span class="opacity-60">Image:</span>
          <span class="font-medium">{{ data.config.template }}</span>
        </div>
        <div v-if="data.config?.os" class="flex items-center gap-1">
          <span class="opacity-60">OS:</span>
          <span class="font-medium">{{ data.config.os }}</span>
        </div>
        <div v-if="data.config?.category" class="flex items-center gap-1">
          <span class="opacity-60">Type:</span>
          <span class="font-medium">{{ data.config.category }}</span>
        </div>
      </div>
    </div>

    <!-- Vulnerability Tags -->
    <div v-if="data.config?.vulnTags?.length" class="mt-2 flex flex-wrap gap-1">
      <span 
        v-for="tag in data.config.vulnTags.slice(0, 3)" 
        :key="tag"
        class="text-xs bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded"
      >
        {{ tag }}
      </span>
      <span v-if="data.config.vulnTags.length > 3" class="text-xs text-red-500">
        +{{ data.config.vulnTags.length - 3 }}
      </span>
    </div>

    <!-- Difficulty Badge -->
    <div class="mt-2">
      <span :class="`text-xs ${difficultyBadge.class} text-white px-2 py-0.5 rounded-full font-medium`">
        {{ difficultyBadge.label }}
      </span>
    </div>

    <!-- Connection Handles - Red themed -->
    <Handle type="target" :position="Position.Top" class="!bg-red-500 !border-red-700 !border-2" />
    <Handle type="source" :position="Position.Bottom" class="!bg-red-500 !border-red-700 !border-2" />
  </div>
</template>
