<script setup>
// Placeholder two-pane viewer. Plan C later tasks wire vue-codemirror6 with scroll-sync.
// For now this renders read-only text in two panes with labels — enough for callers
// to integrate against the props surface.
defineProps({
  left: { type: String, default: '' },
  right: { type: String, default: '' },
  leftLabel: { type: String, default: 'Before' },
  rightLabel: { type: String, default: 'After' },
});
</script>

<template>
  <div class="diff-viewer grid grid-cols-2 gap-2 border border-base-200 rounded">
    <div class="diff-viewer__pane flex flex-col min-w-0">
      <div class="diff-viewer__label bg-base-200 px-2 py-1 text-xs font-semibold">
        {{ leftLabel }}
      </div>
      <pre
        class="diff-viewer__content m-0 p-2 text-xs overflow-auto whitespace-pre-wrap"
      >{{ left }}</pre>
    </div>
    <div class="diff-viewer__pane flex flex-col min-w-0 border-l border-base-200">
      <div class="diff-viewer__label bg-base-200 px-2 py-1 text-xs font-semibold">
        {{ rightLabel }}
      </div>
      <pre
        class="diff-viewer__content m-0 p-2 text-xs overflow-auto whitespace-pre-wrap"
      >{{ right }}</pre>
    </div>
  </div>
</template>
