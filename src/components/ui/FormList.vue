<script setup>
import { computed } from 'vue'

const props = defineProps({
  items: {
    type: Array,
    default: () => []
  },
  addLabel: {
    type: String,
    default: 'Add Item'
  },
  emptyText: {
    type: String,
    default: 'No items configured'
  },
  emptyHint: {
    type: String,
    default: 'Click the button above to add one'
  }
})

const emit = defineEmits(['add', 'remove'])

const isEmpty = computed(() => !props.items || props.items.length === 0)
</script>

<template>
  <div class="form-list">
    <!-- Header -->
    <div class="flex items-center justify-between mb-3">
      <slot name="header"></slot>
      <button 
        type="button" 
        class="btn btn-sm btn-primary gap-1"
        @click="emit('add')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ addLabel }}
      </button>
    </div>

    <!-- Items -->
    <TransitionGroup
      v-if="!isEmpty"
      tag="div"
      class="space-y-2"
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-for="(item, index) in items"
        :key="item.id || index"
        class="group relative bg-base-200/50 border border-base-300 rounded-lg p-3 hover:border-primary/30 transition-colors"
      >
        <slot name="item" :item="item" :index="index"></slot>
        
        <!-- Remove button -->
        <button
          type="button"
          class="absolute top-2 right-2 btn btn-ghost btn-xs text-error opacity-0 group-hover:opacity-100 transition-opacity"
          @click="emit('remove', index)"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </TransitionGroup>

    <!-- Empty State -->
    <div 
      v-else 
      class="text-center py-8 border-2 border-dashed border-base-300 rounded-lg bg-base-200/30"
    >
      <div class="text-base-content/40 text-sm">{{ emptyText }}</div>
      <div class="text-base-content/30 text-xs mt-1">{{ emptyHint }}</div>
    </div>
  </div>
</template>
