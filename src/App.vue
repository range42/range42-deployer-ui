<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const drawerOpen = ref(false)

const menuItems = [
  { name: 'Project', path: '/project', icon: '📋' },
  { name: 'Inventory', path: '/inventory', icon: '📦' }
]

const nodeCategories = [
  {
    name: 'Proxmox',
    icon: '🖥️',
    color: 'text-blue-500',
    items: [
      { type: 'vm-windows', name: 'VM Windows', icon: '🪟', description: 'Windows Virtual Machine' },
      { type: 'vm-linux', name: 'VM Linux', icon: '🐧', description: 'Linux Virtual Machine' },
      { type: 'vm-freebsd', name: 'VM FreeBSD', icon: '👹', description: 'FreeBSD Virtual Machine' },
      { type: 'vm-macos', name: 'VM macOS', icon: '🍎', description: 'macOS Virtual Machine' }
    ]
  },
  {
    name: 'Network',
    icon: '🌐',
    color: 'text-green-500',
    items: [
      { type: 'network', name: 'Network', icon: '🌐', description: 'Network Space' },
      { type: 'subnet', name: 'Subnet', icon: '🔗', description: 'Network Subnet' },
      { type: 'router', name: 'Router', icon: '🛣️', description: 'Network Router' },
      { type: 'firewall', name: 'Firewall', icon: '🔥', description: 'Network Firewall' },
      { type: 'load-balancer', name: 'Load Balancer', icon: '⚖️', description: 'Load Balancer' }
    ]
  },
  {
    name: 'Applications',
    icon: '🐳',
    color: 'text-purple-500',
    items: [
      { type: 'docker', name: 'Docker Container', icon: '🐳', description: 'Docker Container' },
      { type: 'nginx', name: 'Nginx', icon: '🌐', description: 'Nginx Web Server' },
      { type: 'apache', name: 'Apache', icon: '🦅', description: 'Apache Web Server' },
      { type: 'ftp', name: 'FTP Server', icon: '📁', description: 'FTP File Server' },
      { type: 'database', name: 'Database', icon: '🗄️', description: 'Database Server' },
      { type: 'mail', name: 'Mail Server', icon: '📧', description: 'Mail Server' },
      { type: 'dns', name: 'DNS Server', icon: '🔍', description: 'DNS Server' },
      { type: 'vpn', name: 'VPN Server', icon: '🔒', description: 'VPN Server' }
    ]
  }
]

const toggleDrawer = () => {
  drawerOpen.value = !drawerOpen.value
}

const navigateTo = (path) => {
  router.push(path)
  drawerOpen.value = false
}

const handleDragStart = (event, nodeType) => {
  event.dataTransfer.setData('application/vueflow', JSON.stringify({ type: nodeType }))
  event.dataTransfer.effectAllowed = 'move'
}

const handleDragOver = (event) => {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}
</script>

<template>
  <div class="drawer lg:drawer-open">
    <input id="my-drawer-2" type="checkbox" class="drawer-toggle" v-model="drawerOpen" />

    <div class="drawer-content flex flex-col">
      <!-- Enhanced Navbar -->
      <div class="w-full navbar bg-base-100 border-b border-base-300 shadow-sm">
        <div class="flex-none lg:hidden">
          <label for="my-drawer-2" class="btn btn-square btn-ghost" @click="toggleDrawer">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </label>
        </div>
        <div class="flex-1 px-2 mx-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span class="text-white font-bold text-sm">R</span>
            </div>
            <h1 class="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Range42 Deployer
            </h1>
          </div>
        </div>
        <div class="flex-none gap-2">
          <div class="dropdown dropdown-end">
            <div tabindex="0" role="button" class="btn btn-ghost btn-circle avatar">
              <div class="w-10 rounded-full">
                <img alt="Avatar" src="https://daisyui.com/images/stock/photo-1534528741775-53994a69daeb.jpg" />
              </div>
            </div>
            <ul tabindex="0" class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
              <li><a>Profile</a></li>
              <li><a>Settings</a></li>
              <li><a>Logout</a></li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Page content -->
      <div class="flex-1 overflow-hidden">
        <router-view />
      </div>
    </div>

    <!-- Enhanced Sidebar -->
    <div class="drawer-side">
      <label for="my-drawer-2" aria-label="close sidebar" class="drawer-overlay"></label>
      <aside class="min-h-full w-80 bg-base-200 text-base-content border-r border-base-300">
        <div class="p-4">
          <!-- Navigation Menu -->
          <div class="mb-6">
            <h2 class="text-2xl font-bold mb-4 text-base-content">Navigation</h2>
            <ul class="menu menu-lg bg-base-100 rounded-box">
              <li v-for="item in menuItems" :key="item.path">
                <a
                  @click="navigateTo(item.path)"
                  :class="{ 'active': $route.path === item.path }"
                  class="flex items-center gap-3"
                >
                  <span class="text-xl">{{ item.icon }}</span>
                  {{ item.name }}
                </a>
              </li>
            </ul>
          </div>

          <!-- Node Categories -->
          <div class="space-y-6">
            <h2 class="text-xl font-bold text-base-content">Infrastructure Components</h2>

            <div
              v-for="category in nodeCategories"
              :key="category.name"
              class="collapse collapse-arrow bg-base-100 rounded-box shadow-sm"
            >
              <input type="checkbox" checked />
              <div class="collapse-title flex items-center gap-2 font-semibold">
                <span :class="['text-xl', category.color]">{{ category.icon }}</span>
                {{ category.name }}
              </div>
              <div class="collapse-content">
                <div class="space-y-2 pt-2">
                  <div
                    v-for="item in category.items"
                    :key="item.type"
                    draggable="true"
                    @dragstart="handleDragStart($event, item.type)"
                    @dragover="handleDragOver"
                    class="group cursor-grab active:cursor-grabbing"
                  >
                    <div class="flex items-center gap-3 p-3 rounded-lg bg-base-200 hover:bg-base-300 transition-colors duration-200 group-hover:shadow-md">
                      <div class="flex-shrink-0">
                        <span class="text-2xl">{{ item.icon }}</span>
                      </div>
                      <div class="flex-1 min-w-0">
                        <h3 class="font-medium text-sm text-base-content">{{ item.name }}</h3>
                        <p class="text-xs text-base-content/70 truncate">{{ item.description }}</p>
                      </div>
                      <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <svg class="w-4 h-4 text-base-content/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Actions -->
          <div class="mt-6 pt-6 border-t border-base-300">
            <h3 class="text-sm font-semibold mb-3 text-base-content/70">Quick Actions</h3>
            <div class="space-y-2">
              <button class="btn btn-primary btn-sm w-full">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                </svg>
                New Project
              </button>
              <button class="btn btn-outline btn-sm w-full">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                </svg>
                Import Project
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.drawer-content {
  height: 100vh;
}

.collapse-content {
  max-height: none !important;
}
</style>
