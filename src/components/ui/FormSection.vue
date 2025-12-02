<script setup>
import { ref } from 'vue'

const props = defineProps({
  title: {
    type: String,
    default: ''
  },
  subtitle: {
    type: String,
    default: ''
  },
  icon: {
    type: String,
    default: ''
  },
  collapsible: {
    type: Boolean,
    default: false
  },
  defaultOpen: {
    type: Boolean,
    default: true
  },
  variant: {
    type: String,
    default: 'default',
    validator: (v) => ['default', 'card', 'bordered'].includes(v)
  },
  columns: {
    type: Number,
    default: 1,
    validator: (v) => [1, 2, 3, 4].includes(v)
  }
})

const isOpen = ref(props.defaultOpen)

const toggle = () => {
  if (props.collapsible) {
    isOpen.value = !isOpen.value
  }
}

const wrapperClasses = {
  default: '',
  card: 'bg-base-200/50 rounded-xl p-4',
  bordered: 'border border-base-300 rounded-xl p-4'
}

const gridClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
}
</script>

<template>
  <div :class="['form-section', wrapperClasses[variant]]">
    <!-- Section Header -->
    <div 
      v-if="title || icon || $slots.header" 
      class="flex items-center justify-between mb-4"
      :class="{ 'cursor-pointer hover:text-primary transition-colors': collapsible }"
      @click="toggle"
    >
      <div class="flex items-center gap-2">
        <span v-if="icon" class="text-lg">{{ icon }}</span>
        <div>
          <h4 class="font-semibold text-base">
            <slot name="header">{{ title }}</slot>
          </h4>
          <p v-if="subtitle" class="text-xs text-base-content/60 mt-0.5">{{ subtitle }}</p>
        </div>
      </div>
      
      <div class="flex items-center gap-2">
        <slot name="headerActions"></slot>
        <button 
          v-if="collapsible"
          type="button"
          class="btn btn-ghost btn-xs btn-circle"
        >
          <svg 
            class="w-4 h-4 transition-transform duration-200" 
            :class="{ 'rotate-180': !isOpen }"
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Section Content -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div v-show="isOpen || !collapsible" :class="['grid gap-4', gridClasses[columns]]">
        <slot></slot>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.form-section + .form-section {
  margin-top: 1.5rem;
}
</style>
