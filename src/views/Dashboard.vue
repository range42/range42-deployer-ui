<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/projectStore'

const router = useRouter()
const projectStore = useProjectStore()

const showCreateModal = ref(false)
const newProjectName = ref('')

onMounted(() => {
  projectStore.loadProjects()
})

const createProject = () => {
  if (newProjectName.value.trim()) {
    const project = projectStore.createProject(newProjectName.value.trim())
    router.push(`/project/${project.id}`)
  }
}

const openProject = (projectId) => {
  router.push(`/project/${projectId}`)
}

const deleteProject = (projectId) => {
  if (confirm('Are you sure you want to delete this project?')) {
    projectStore.deleteProject(projectId)
  }
}
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <!-- Header -->
    <div class="navbar bg-base-200 shadow-sm">
      <div class="navbar-start">
        <h1 class="text-2xl font-bold">🏗️ Range42 Deployer</h1>
      </div>
      <div class="navbar-end">
        <button class="btn btn-primary" @click="showCreateModal = true">
          ➕ New Project
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container mx-auto p-6">
      <!-- Welcome Section -->
      <div class="hero bg-base-200 rounded-lg mb-8">
        <div class="hero-content text-center">
          <div class="max-w-md">
            <h2 class="text-3xl font-bold">Visual Infrastructure Builder</h2>
            <p class="py-4">
              Design, configure, and deploy complex infrastructure systems using an intuitive node-based visual editor.
            </p>
            <button class="btn btn-primary" @click="showCreateModal = true">
              Get Started
            </button>
          </div>
        </div>
      </div>

      <!-- Projects Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <!-- Create New Project Card -->
        <div
          class="card bg-base-100 shadow-md border-2 border-dashed border-base-300 hover:border-primary cursor-pointer transition-colors"
          @click="showCreateModal = true"
        >
          <div class="card-body items-center text-center">
            <div class="text-4xl opacity-50 mb-2">➕</div>
            <h3 class="card-title">Create New Project</h3>
            <p class="text-sm opacity-70">Start building your infrastructure</p>
          </div>
        </div>

        <!-- Existing Projects -->
        <div
          v-for="project in projectStore.projects"
          :key="project.id"
          class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow cursor-pointer"
          @click="openProject(project.id)"
        >
          <div class="card-body">
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <h3 class="card-title text-lg">{{ project.name }}</h3>
                <p class="text-sm opacity-70 mb-2">
                  {{ project.nodes?.length || 0 }} components
                </p>
                <div class="text-xs opacity-50">
                  Modified: {{ new Date(project.modified).toLocaleDateString() }}
                </div>
              </div>
              <div class="dropdown dropdown-end" @click.stop>
                <label tabindex="0" class="btn btn-ghost btn-sm">⋮</label>
                <ul class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-40">
                  <li><a @click="openProject(project.id)">✏️ Edit</a></li>
                  <li><a @click="deleteProject(project.id)" class="text-error">🗑️ Delete</a></li>
                </ul>
              </div>
            </div>

            <!-- Status Overview -->
            <div class="flex space-x-2 mt-3">
              <div class="tooltip" data-tip="Ready to deploy">
                <div class="badge badge-warning badge-sm">
                  {{ project.nodes?.filter(n => n.data?.status === 'orange').length || 0 }}
                </div>
              </div>
              <div class="tooltip" data-tip="Deployed">
                <div class="badge badge-success badge-sm">
                  {{ project.nodes?.filter(n => n.data?.status === 'green').length || 0 }}
                </div>
              </div>
              <div class="tooltip" data-tip="Errors">
                <div class="badge badge-error badge-sm">
                  {{ project.nodes?.filter(n => n.data?.status === 'red').length || 0 }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="projectStore.projects.length === 0" class="text-center py-12">
        <div class="text-6xl opacity-20 mb-4">🏗️</div>
        <h3 class="text-xl font-semibold mb-2">No projects yet</h3>
        <p class="text-sm opacity-70 mb-4">Create your first infrastructure project to get started</p>
        <button class="btn btn-primary" @click="showCreateModal = true">
          Create Project
        </button>
      </div>
    </div>

    <!-- Create Project Modal -->
    <div v-if="showCreateModal" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Create New Project</h3>

        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text">Project Name</span>
          </label>
          <input
            v-model="newProjectName"
            type="text"
            class="input input-bordered"
            placeholder="Enter project name"
            @keyup.enter="createProject"
          />
        </div>

        <div class="modal-action">
          <button class="btn" @click="showCreateModal = false; newProjectName = ''">
            Cancel
          </button>
          <button
            class="btn btn-primary"
            :disabled="!newProjectName.trim()"
            @click="createProject"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
