<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/projectStore'

const router = useRouter()
const projectStore = useProjectStore()

const showCreateModal = ref(false)
const newProjectName = ref('')
const newProjectDescription = ref('')
const searchQuery = ref('')
const viewMode = ref('grid') // 'grid' | 'list'

onMounted(() => {
  projectStore.loadProjects()
})

const filteredProjects = computed(() => {
  if (!searchQuery.value) return projectStore.projects
  const query = searchQuery.value.toLowerCase()
  return projectStore.projects.filter(p => 
    p.name.toLowerCase().includes(query)
  )
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

const deleteProject = (projectId, event) => {
  event.stopPropagation()
  if (confirm('Are you sure you want to delete this project?')) {
    projectStore.deleteProject(projectId)
  }
}

const duplicateProject = (project, event) => {
  event.stopPropagation()
  const newProject = projectStore.createProject(`${project.name} (Copy)`)
  projectStore.updateProject(newProject.id, {
    nodes: project.nodes || [],
    edges: project.edges || []
  })
}

const getProjectStats = (project) => {
  const nodes = project.nodes || []
  return {
    total: nodes.length,
    ready: nodes.filter(n => n.data?.status === 'orange').length,
    running: nodes.filter(n => n.data?.status === 'green').length,
    error: nodes.filter(n => n.data?.status === 'red').length,
  }
}

const formatDate = (date) => {
  const d = new Date(date)
  const now = new Date()
  const diff = now - d
  
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return d.toLocaleDateString()
}
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <!-- Header -->
    <header class="sticky top-0 z-40 glass border-b border-base-300">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <!-- Logo -->
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <span class="text-xl">🚀</span>
            </div>
            <div>
              <h1 class="text-lg font-bold">Range42</h1>
              <p class="text-xs text-base-content/60">Infrastructure Deployer</p>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <button class="btn btn-ghost btn-sm gap-2" title="Settings">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
            </button>
            <button class="btn btn-primary btn-sm gap-2" @click="showCreateModal = true">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
              </svg>
              New Project
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Hero Section -->
      <section class="mb-12">
        <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-base-200 to-secondary/20 p-8 md:p-12">
          <div class="absolute inset-0 bg-grid-pattern opacity-5"></div>
          <div class="relative z-10 max-w-2xl">
            <h2 class="text-3xl md:text-4xl font-bold heading-display mb-4">
              Build Infrastructure <span class="text-gradient">Visually</span>
            </h2>
            <p class="text-base-content/70 text-lg mb-6">
              Design, configure, and deploy Proxmox-based infrastructure using an intuitive drag-and-drop visual editor.
            </p>
            <div class="flex flex-wrap gap-3">
              <button class="btn btn-primary gap-2" @click="showCreateModal = true">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
                Create Project
              </button>
              <button class="btn btn-ghost gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
                </svg>
                Documentation
              </button>
            </div>
          </div>
          
          <!-- Decorative elements -->
          <div class="absolute right-8 top-1/2 -translate-y-1/2 hidden lg:block opacity-20">
            <div class="grid grid-cols-3 gap-3">
              <div class="w-16 h-16 rounded-xl bg-primary"></div>
              <div class="w-16 h-16 rounded-xl bg-secondary"></div>
              <div class="w-16 h-16 rounded-xl bg-accent"></div>
              <div class="w-16 h-16 rounded-xl bg-secondary"></div>
              <div class="w-16 h-16 rounded-xl bg-primary"></div>
              <div class="w-16 h-16 rounded-xl bg-secondary"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Projects Section -->
      <section>
        <!-- Section Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 class="text-xl font-semibold">Your Projects</h3>
            <p class="text-sm text-base-content/60">{{ projectStore.projects.length }} project{{ projectStore.projects.length !== 1 ? 's' : '' }}</p>
          </div>
          
          <div class="flex items-center gap-3">
            <!-- Search -->
            <div class="relative">
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Search projects..."
                class="input input-bordered input-sm w-48 pl-9"
              />
              <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
            </div>
            
            <!-- View Toggle -->
            <div class="join">
              <button 
                class="btn btn-sm join-item" 
                :class="{ 'btn-active': viewMode === 'grid' }"
                @click="viewMode = 'grid'"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path>
                </svg>
              </button>
              <button 
                class="btn btn-sm join-item" 
                :class="{ 'btn-active': viewMode === 'list' }"
                @click="viewMode = 'list'"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Grid View -->
        <div v-if="viewMode === 'grid'" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <!-- Create New Card -->
          <div
            class="group border-2 border-dashed border-base-300 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition-all min-h-[200px]"
            @click="showCreateModal = true"
          >
            <div class="w-14 h-14 rounded-2xl bg-base-200 group-hover:bg-primary/20 flex items-center justify-center mb-4 transition-colors">
              <svg class="w-7 h-7 text-base-content/40 group-hover:text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
              </svg>
            </div>
            <h4 class="font-semibold mb-1">New Project</h4>
            <p class="text-sm text-base-content/50">Start from scratch</p>
          </div>

          <!-- Project Cards -->
          <div
            v-for="project in filteredProjects"
            :key="project.id"
            class="card bg-base-100 border border-base-300 card-hover cursor-pointer group"
            @click="openProject(project.id)"
          >
            <div class="card-body p-5">
              <!-- Header -->
              <div class="flex items-start justify-between mb-3">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <span class="text-lg">📐</span>
                  </div>
                  <div>
                    <h4 class="font-semibold line-clamp-1">{{ project.name }}</h4>
                    <p class="text-xs text-base-content/50">{{ formatDate(project.modified) }}</p>
                  </div>
                </div>
                
                <!-- Actions Dropdown -->
                <div class="dropdown dropdown-end" @click.stop>
                  <label tabindex="0" class="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>
                    </svg>
                  </label>
                  <ul class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-xl w-44 border border-base-300">
                    <li><a @click="openProject(project.id)" class="gap-2">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                      Edit
                    </a></li>
                    <li><a @click="duplicateProject(project, $event)" class="gap-2">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                      Duplicate
                    </a></li>
                    <div class="divider my-1"></div>
                    <li><a @click="deleteProject(project.id, $event)" class="text-error gap-2">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                      Delete
                    </a></li>
                  </ul>
                </div>
              </div>

              <!-- Stats -->
              <div class="flex items-center gap-4 text-sm">
                <div class="flex items-center gap-1.5 text-base-content/60">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
                  </svg>
                  <span>{{ getProjectStats(project).total }} nodes</span>
                </div>
              </div>

              <!-- Status Badges -->
              <div class="flex items-center gap-2 mt-3 pt-3 border-t border-base-200">
                <div v-if="getProjectStats(project).running > 0" class="badge badge-success badge-sm gap-1">
                  <span class="status-dot green w-1.5 h-1.5"></span>
                  {{ getProjectStats(project).running }} running
                </div>
                <div v-if="getProjectStats(project).ready > 0" class="badge badge-warning badge-sm gap-1">
                  <span class="status-dot orange w-1.5 h-1.5"></span>
                  {{ getProjectStats(project).ready }} ready
                </div>
                <div v-if="getProjectStats(project).error > 0" class="badge badge-error badge-sm gap-1">
                  <span class="status-dot red w-1.5 h-1.5"></span>
                  {{ getProjectStats(project).error }} error
                </div>
                <div v-if="getProjectStats(project).total === 0" class="badge badge-ghost badge-sm">
                  Empty
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- List View -->
        <div v-else class="space-y-2">
          <div
            v-for="project in filteredProjects"
            :key="project.id"
            class="flex items-center gap-4 p-4 rounded-xl border border-base-300 hover:border-primary/30 hover:bg-base-200/50 cursor-pointer transition-all group"
            @click="openProject(project.id)"
          >
            <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <span class="text-lg">📐</span>
            </div>
            
            <div class="flex-1 min-w-0">
              <h4 class="font-semibold truncate">{{ project.name }}</h4>
              <p class="text-sm text-base-content/50">{{ getProjectStats(project).total }} nodes · Modified {{ formatDate(project.modified) }}</p>
            </div>

            <div class="flex items-center gap-2">
              <div v-if="getProjectStats(project).running > 0" class="badge badge-success badge-sm">{{ getProjectStats(project).running }}</div>
              <div v-if="getProjectStats(project).ready > 0" class="badge badge-warning badge-sm">{{ getProjectStats(project).ready }}</div>
              <div v-if="getProjectStats(project).error > 0" class="badge badge-error badge-sm">{{ getProjectStats(project).error }}</div>
            </div>
            
            <button 
              class="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition-opacity"
              @click.stop="deleteProject(project.id, $event)"
            >
              <svg class="w-4 h-4 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="filteredProjects.length === 0 && searchQuery" class="text-center py-16">
          <div class="w-16 h-16 rounded-2xl bg-base-200 flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
          </div>
          <h3 class="text-lg font-semibold mb-2">No results found</h3>
          <p class="text-base-content/60">Try a different search term</p>
        </div>

        <div v-if="projectStore.projects.length === 0 && !searchQuery" class="text-center py-16">
          <div class="w-20 h-20 rounded-2xl bg-base-200 flex items-center justify-center mx-auto mb-6">
            <span class="text-4xl">🏗️</span>
          </div>
          <h3 class="text-xl font-semibold mb-2">No projects yet</h3>
          <p class="text-base-content/60 mb-6 max-w-md mx-auto">
            Create your first infrastructure project to start designing and deploying.
          </p>
          <button class="btn btn-primary gap-2" @click="showCreateModal = true">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
            </svg>
            Create Your First Project
          </button>
        </div>
      </section>
    </main>

    <!-- Create Project Modal -->
    <div v-if="showCreateModal" class="modal modal-open">
      <div class="modal-box max-w-md">
        <button 
          class="btn btn-sm btn-circle btn-ghost absolute right-4 top-4"
          @click="showCreateModal = false; newProjectName = ''"
        >✕</button>
        
        <h3 class="text-xl font-bold mb-6">Create New Project</h3>

        <div class="space-y-4">
          <div class="form-control">
            <label class="label">
              <span class="label-text font-medium">Project Name</span>
            </label>
            <input
              v-model="newProjectName"
              type="text"
              class="input input-bordered"
              placeholder="My Infrastructure Project"
              @keyup.enter="createProject"
              autofocus
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text font-medium">Description</span>
              <span class="label-text-alt text-base-content/50">Optional</span>
            </label>
            <textarea
              v-model="newProjectDescription"
              class="textarea textarea-bordered h-20"
              placeholder="What will you build?"
            ></textarea>
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="showCreateModal = false; newProjectName = ''">
            Cancel
          </button>
          <button
            class="btn btn-primary"
            :disabled="!newProjectName.trim()"
            @click="createProject"
          >
            Create Project
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="showCreateModal = false"></div>
    </div>
  </div>
</template>

<style scoped>
.bg-grid-pattern {
  background-image: 
    linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
  background-size: 20px 20px;
}

.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
