<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/projectStore'
import { useInventoryStore } from '../stores/inventoryStore'
import { getGitHubProvider } from '../services/git/github'

const router = useRouter()
const projectStore = useProjectStore()
const inventoryStore = useInventoryStore()

const settings = ref({
  theme: 'light',
  autoSave: true,
  gridSize: 20,
  snapToGrid: true
})

// ===========================================================================
// GitHub Authentication
// ===========================================================================

const githubProvider = getGitHubProvider()
const githubToken = ref('')
const githubUser = ref(null)
const isValidatingToken = ref(false)
const tokenError = ref('')
const showTokenInput = ref(false)

// Check if we have a stored token on mount
onMounted(async () => {
  const storedToken = githubProvider.getToken()
  if (storedToken) {
    githubToken.value = storedToken
    await validateToken()
  }
})

async function validateToken() {
  if (!githubToken.value) {
    githubUser.value = null
    return
  }
  
  try {
    isValidatingToken.value = true
    tokenError.value = ''
    
    githubProvider.setToken(githubToken.value)
    const user = await githubProvider.getUser()
    githubUser.value = user
    showTokenInput.value = false
  } catch (e) {
    tokenError.value = e.message || 'Invalid token'
    githubUser.value = null
  } finally {
    isValidatingToken.value = false
  }
}

function saveGitHubToken() {
  validateToken()
}

function disconnectGitHub() {
  githubProvider.logout()
  githubToken.value = ''
  githubUser.value = null
  tokenError.value = ''
}

const isGitHubConnected = computed(() => !!githubUser.value)

// ===========================================================================
// Inventory Repositories (using real store)
// ===========================================================================

const inventoryRepos = computed(() => inventoryStore.registeredRepos)
const newRepoUrl = ref('')
const showAddRepo = ref(false)
const addRepoError = ref('')
const isAddingRepo = ref(false)

async function addRepo() {
  if (!newRepoUrl.value.trim()) {
    addRepoError.value = 'Please enter a repository URL'
    return
  }
  
  try {
    isAddingRepo.value = true
    addRepoError.value = ''
    
    await inventoryStore.addRepository(newRepoUrl.value.trim())
    
    newRepoUrl.value = ''
    showAddRepo.value = false
  } catch (e) {
    addRepoError.value = e.message || 'Failed to add repository'
  } finally {
    isAddingRepo.value = false
  }
}

function removeRepo(repoId) {
  if (confirm('Remove this inventory repository?')) {
    inventoryStore.removeRepository(repoId)
  }
}

async function refreshRepo(repoId) {
  try {
    await inventoryStore.refreshRepository(repoId)
  } catch (e) {
    console.error('Failed to refresh repository:', e)
  }
}

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

      <!-- GitHub Authentication -->
      <div class="card bg-base-100 shadow-md mb-6">
        <div class="card-body">
          <h2 class="card-title gap-2">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub Authentication
          </h2>

          <!-- Connected State -->
          <div v-if="isGitHubConnected" class="mt-4">
            <div class="flex items-center gap-4 p-4 bg-success/10 rounded-xl border border-success/30">
              <img
                v-if="githubUser.avatarUrl"
                :src="githubUser.avatarUrl"
                :alt="githubUser.login"
                class="w-12 h-12 rounded-full"
              />
              <div class="flex-1">
                <div class="font-semibold text-success">Connected as {{ githubUser.login }}</div>
                <div class="text-sm text-base-content/60">{{ githubUser.name || githubUser.email || 'GitHub user' }}</div>
              </div>
              <button class="btn btn-ghost btn-sm text-error" @click="disconnectGitHub">
                Disconnect
              </button>
            </div>
          </div>

          <!-- Not Connected State -->
          <div v-else class="mt-4">
            <p class="text-sm text-base-content/60 mb-4">
              Connect your GitHub account to access private repositories.
            </p>

            <!-- Token Input -->
            <div v-if="showTokenInput" class="space-y-4">
              <div class="form-control">
                <label class="label">
                  <span class="label-text font-medium">Personal Access Token (PAT)</span>
                </label>
                <input
                  v-model="githubToken"
                  type="password"
                  class="input input-bordered font-mono"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  @keyup.enter="saveGitHubToken"
                />
              </div>

              <!-- How to create PAT -->
              <div class="collapse collapse-arrow bg-base-200 rounded-lg">
                <input type="checkbox" />
                <div class="collapse-title text-sm font-medium">
                  How to create a Personal Access Token
                </div>
                <div class="collapse-content text-sm">
                  <ol class="list-decimal list-inside space-y-2 text-base-content/70">
                    <li>Go to <a href="https://github.com/settings/tokens?type=beta" target="_blank" class="link link-primary">GitHub Settings → Developer settings → Personal access tokens</a></li>
                    <li>Click <strong>"Generate new token"</strong> (Fine-grained)</li>
                    <li>Set a name like "Range42 Deployer"</li>
                    <li>Under <strong>Repository access</strong>, select repos you want to access</li>
                    <li>Under <strong>Permissions → Repository permissions</strong>, set <strong>Contents</strong> to "Read-only"</li>
                    <li>Click <strong>"Generate token"</strong> and copy it</li>
                  </ol>
                  <div class="alert alert-info mt-3 text-xs">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-5 h-5">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <span>Your token is stored locally in your browser and never sent to our servers.</span>
                  </div>
                </div>
              </div>

              <!-- Error message -->
              <div v-if="tokenError" class="alert alert-error">
                <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{{ tokenError }}</span>
              </div>

              <div class="flex gap-2">
                <button class="btn btn-ghost" @click="showTokenInput = false; githubToken = ''">
                  Cancel
                </button>
                <button
                  class="btn btn-primary"
                  :disabled="!githubToken || isValidatingToken"
                  :class="{ 'loading': isValidatingToken }"
                  @click="saveGitHubToken"
                >
                  {{ isValidatingToken ? 'Validating...' : 'Connect' }}
                </button>
              </div>
            </div>

            <!-- Connect Button -->
            <button v-else class="btn btn-primary gap-2" @click="showTokenInput = true">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              Connect GitHub Account
            </button>
          </div>
        </div>
      </div>

      <!-- Inventory Repositories -->
      <div class="card bg-base-100 shadow-md mb-6">
        <div class="card-body">
          <div class="flex items-center justify-between mb-4">
            <h2 class="card-title">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
              </svg>
              Inventory Repositories
            </h2>
            <button class="btn btn-primary btn-sm gap-2" @click="showAddRepo = true">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
              </svg>
              Add Repository
            </button>
          </div>

          <p class="text-sm text-base-content/60 mb-4">
            Add GitHub repositories containing infrastructure templates.
            <span v-if="!isGitHubConnected" class="text-warning">Connect GitHub above to access private repos.</span>
          </p>

          <!-- Repository List -->
          <div v-if="inventoryRepos.length" class="space-y-3">
            <div
              v-for="repo in inventoryRepos"
              :key="repo.id"
              class="flex items-center gap-4 p-4 rounded-xl border border-base-300 hover:border-primary/30 transition-colors"
            >
              <div class="w-10 h-10 rounded-lg bg-base-200 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-semibold">{{ repo.manifest?.name || repo.repo }}</div>
                <div class="text-sm text-base-content/50 truncate">{{ repo.owner }}/{{ repo.repo }}</div>
                <div class="flex items-center gap-2 mt-1">
                  <span class="badge badge-sm badge-outline">{{ repo.branch }}</span>
                  <span v-if="repo.manifest?.components" class="text-xs text-base-content/40">
                    {{ repo.manifest.components.vms || 0 }} VMs
                  </span>
                  <span v-if="repo.isWritable" class="badge badge-xs badge-success">write</span>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm btn-square" @click="refreshRepo(repo.id)" title="Refresh">
                <svg class="w-4 h-4" :class="{ 'animate-spin': inventoryStore.isLoading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
              </button>
              <button class="btn btn-ghost btn-sm btn-square text-error" @click="removeRepo(repo.id)" title="Remove">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
              </button>
            </div>
          </div>

          <!-- Empty State -->
          <div v-else class="text-center py-8 text-base-content/50">
            <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
            </svg>
            <p>No inventory repositories configured</p>
            <p class="text-sm">Add a GitHub repository to browse templates</p>
          </div>

          <!-- Add Repository Modal -->
          <div v-if="showAddRepo" class="modal modal-open">
            <div class="modal-box max-w-lg">
              <h3 class="text-lg font-bold mb-4">Add Inventory Repository</h3>
              
              <div class="space-y-4">
                <div class="form-control">
                  <label class="label">
                    <span class="label-text font-medium">GitHub Repository URL</span>
                  </label>
                  <input
                    v-model="newRepoUrl"
                    type="text"
                    class="input input-bordered"
                    placeholder="https://github.com/owner/repo or owner/repo"
                    @keyup.enter="addRepo"
                  />
                  <label class="label">
                    <span class="label-text-alt">The repo must contain a manifest.json file</span>
                  </label>
                </div>

                <!-- Error message -->
                <div v-if="addRepoError" class="alert alert-error">
                  <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{{ addRepoError }}</span>
                </div>

                <!-- Private repo hint -->
                <div v-if="!isGitHubConnected" class="alert alert-warning">
                  <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span class="text-sm">Connect GitHub above to access private repositories</span>
                </div>
              </div>

              <div class="modal-action">
                <button class="btn btn-ghost" @click="showAddRepo = false; addRepoError = ''">Cancel</button>
                <button
                  class="btn btn-primary"
                  :disabled="!newRepoUrl.trim() || isAddingRepo"
                  :class="{ 'loading': isAddingRepo }"
                  @click="addRepo"
                >
                  {{ isAddingRepo ? 'Adding...' : 'Add Repository' }}
                </button>
              </div>
            </div>
            <div class="modal-backdrop" @click="showAddRepo = false"></div>
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
