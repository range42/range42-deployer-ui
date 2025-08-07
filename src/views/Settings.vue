<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/projectStore'

const router = useRouter()
const projectStore = useProjectStore()

const settings = ref({
  theme: 'light',
  autoSave: true,
  gridSize: 20,
  snapToGrid: true
})

const goBack = () => {
  router.push('/')
}

const clearAllData = () => {
  if (confirm('This will delete all projects and settings. Are you sure?')) {
    projectStore.clearAllData()
    localStorage.clear()
    alert('All data cleared successfully')
  }
}
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <!-- Header -->
    <div class="navbar bg-base-200 shadow-sm">
      <div class="navbar-start">
        <button class="btn btn-ghost" @click="goBack">
          ← Back
        </button>
        <h1 class="text-2xl font-bold ml-4">Settings</h1>
      </div>
    </div>

    <!-- Settings Content -->
    <div class="container mx-auto p-6 max-w-2xl">
      <!-- Theme Settings -->
      <div class="card bg-base-100 shadow-md mb-6">
        <div class="card-body">
          <h2 class="card-title">Appearance</h2>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Theme</span>
            </label>
            <select v-model="settings.theme" class="select select-bordered w-full max-w-xs">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="cupcake">Cupcake</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Editor Settings -->
      <div class="card bg-base-100 shadow-md mb-6">
        <div class="card-body">
          <h2 class="card-title">Editor</h2>

          <div class="form-control">
            <label class="cursor-pointer label">
              <span class="label-text">Auto-save projects</span>
              <input v-model="settings.autoSave" type="checkbox" class="toggle toggle-primary" />
            </label>
          </div>

          <div class="form-control">
            <label class="cursor-pointer label">
              <span class="label-text">Snap to grid</span>
              <input v-model="settings.snapToGrid" type="checkbox" class="toggle toggle-primary" />
            </label>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Grid size</span>
            </label>
            <input
              v-model.number="settings.gridSize"
              type="range"
              min="10"
              max="50"
              class="range range-primary"
            />
            <div class="text-sm opacity-70 mt-1">{{ settings.gridSize }}px</div>
          </div>
        </div>
      </div>

      <!-- Data Management -->
      <div class="card bg-base-100 shadow-md mb-6">
        <div class="card-body">
          <h2 class="card-title">Data Management</h2>

          <div class="stats shadow">
            <div class="stat">
              <div class="stat-title">Total Projects</div>
              <div class="stat-value">{{ projectStore.projects.length }}</div>
            </div>

            <div class="stat">
              <div class="stat-title">Storage Used</div>
              <div class="stat-value text-sm">
                {{ Math.round(JSON.stringify(projectStore.projects).length / 1024) }}KB
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="alert alert-warning">
            <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <h3 class="font-bold">Danger Zone</h3>
              <div class="text-xs">This action cannot be undone</div>
            </div>
            <button class="btn btn-error btn-sm" @click="clearAllData">
              Clear All Data
            </button>
          </div>
        </div>
      </div>

      <!-- About -->
      <div class="card bg-base-100 shadow-md">
        <div class="card-body">
          <h2 class="card-title">About Range42 Deployer</h2>
          <p class="text-sm opacity-70">
            Visual infrastructure builder powered by VueFlow and DaisyUI.
            Build, configure, and deploy complex infrastructure systems through an intuitive interface.
          </p>
          <div class="mt-4">
            <div class="badge badge-outline">Version 1.0.0</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
