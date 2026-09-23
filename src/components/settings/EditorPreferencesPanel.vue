<script setup lang="ts">
import { useEditorPreferencesStore } from '@/stores/editorPreferencesStore'

const preferences = useEditorPreferencesStore()
</script>

<template>
  <section class="card bg-base-100 shadow-md" aria-labelledby="editor-preferences-heading">
    <div class="card-body space-y-3">
      <h2 id="editor-preferences-heading" class="card-title">Editor preferences</h2>
      <div class="flex items-center justify-between gap-4">
        <label for="editor-auto-save-git">Automatically save the Git working branch</label>
        <input id="editor-auto-save-git" v-model="preferences.autoSaveToGit" type="checkbox"
          class="toggle toggle-primary shrink-0" aria-describedby="editor-auto-save-help" />
      </div>
      <p id="editor-auto-save-help" class="text-sm text-base-content/70">
        Local drafts are always kept in this browser. For connected projects, this saves edits to the working branch after a pause.
        Explicit Save and Save-and-Deploy still work when this is off. A save already running may finish.
        Publishing to another target or merging remains a separate action.
      </p>
      <div class="flex items-center justify-between gap-4">
        <label for="editor-snap-to-grid">Snap nodes to grid</label>
        <input id="editor-snap-to-grid" v-model="preferences.snapToGrid" type="checkbox" class="toggle toggle-primary shrink-0" />
      </div>
      <div class="space-y-2">
        <label for="editor-grid-size" class="block font-medium">Grid spacing: {{ preferences.gridSize }} px</label>
        <input id="editor-grid-size" v-model.number="preferences.gridSize" type="range" min="10" max="50" step="1"
          class="range range-primary w-full" :aria-valuetext="`${preferences.gridSize} pixels`" aria-describedby="editor-grid-help" />
        <p id="editor-grid-help" class="text-sm text-base-content/70">Controls the visible grid and snapping distance. Existing node positions stay unchanged until moved.</p>
      </div>
      <p v-if="preferences.storageError" role="status" class="text-sm text-warning">{{ preferences.storageError }}</p>
    </div>
  </section>
</template>
