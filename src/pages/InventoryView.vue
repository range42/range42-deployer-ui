<script setup>
import { ref, computed } from 'vue'

const inventoryItems = ref([
  // Proxmox VM Templates
  {
    id: 'vm-windows-template',
    type: 'vm-windows',
    name: 'Windows Server Template',
    description: 'Pre-configured Windows Server with IIS and .NET',
    config: {
      cpu: 4,
      memory: '8GB',
      disk: '100GB',
      os: 'Windows Server 2022',
      network: 'LAN'
    },
    tags: ['windows', 'server', 'iis', 'production']
  },
  {
    id: 'vm-linux-template',
    type: 'vm-linux',
    name: 'Ubuntu Server Template',
    description: 'Ubuntu Server with LAMP stack',
    config: {
      cpu: 2,
      memory: '4GB',
      disk: '50GB',
      os: 'Ubuntu 22.04 LTS',
      network: 'LAN'
    },
    tags: ['linux', 'ubuntu', 'lamp', 'web']
  },
  {
    id: 'vm-freebsd-template',
    type: 'vm-freebsd',
    name: 'FreeBSD Server Template',
    description: 'FreeBSD server optimized for performance',
    config: {
      cpu: 2,
      memory: '4GB',
      disk: '40GB',
      os: 'FreeBSD 13.2',
      network: 'LAN'
    },
    tags: ['freebsd', 'server', 'performance']
  },

  // Network Templates
  {
    id: 'network-production',
    type: 'network',
    name: 'Production Network',
    description: 'Production network with proper segmentation',
    config: {
      cidr: '10.0.0.0/16',
      gateway: '10.0.0.1',
      dns: ['8.8.8.8', '8.8.4.4']
    },
    tags: ['production', 'network', 'segmentation']
  },
  {
    id: 'network-development',
    type: 'network',
    name: 'Development Network',
    description: 'Development network for testing',
    config: {
      cidr: '192.168.1.0/24',
      gateway: '192.168.1.1',
      dns: ['8.8.8.8', '8.8.4.4']
    },
    tags: ['development', 'network', 'testing']
  },
  {
    id: 'subnet-web',
    type: 'subnet',
    name: 'Web Server Subnet',
    description: 'Subnet for web servers',
    config: {
      cidr: '10.0.1.0/24',
      gateway: '10.0.1.1',
      parent_network: 'production-network'
    },
    tags: ['subnet', 'web', 'servers']
  },
  {
    id: 'router-cisco',
    type: 'router',
    name: 'Cisco Router',
    description: 'Cisco router with OSPF routing',
    config: {
      model: 'Cisco ISR 4321',
      routing_protocol: 'OSPF'
    },
    tags: ['router', 'cisco', 'ospf']
  },
  {
    id: 'firewall-pfsense',
    type: 'firewall',
    name: 'pfSense Firewall',
    description: 'pfSense firewall with advanced rules',
    config: {
      type: 'pfSense',
      rules: ['allow_web', 'block_malicious']
    },
    tags: ['firewall', 'pfsense', 'security']
  },
  {
    id: 'load-balancer-nginx',
    type: 'load-balancer',
    name: 'Nginx Load Balancer',
    description: 'Nginx load balancer with health checks',
    config: {
      algorithm: 'round-robin',
      health_check: true
    },
    tags: ['load-balancer', 'nginx', 'high-availability']
  },

  // Application Templates
  {
    id: 'docker-nginx',
    type: 'docker',
    name: 'Nginx Container',
    description: 'Nginx web server container',
    config: {
      image: 'nginx:latest',
      ports: ['80:80', '443:443'],
      environment: ['NGINX_HOST=localhost']
    },
    tags: ['docker', 'nginx', 'web']
  },
  {
    id: 'docker-postgres',
    type: 'docker',
    name: 'PostgreSQL Container',
    description: 'PostgreSQL database container',
    config: {
      image: 'postgres:15',
      ports: ['5432:5432'],
      environment: ['POSTGRES_DB=app', 'POSTGRES_USER=admin']
    },
    tags: ['docker', 'postgresql', 'database']
  },
  {
    id: 'nginx-server',
    type: 'nginx',
    name: 'Nginx Web Server',
    description: 'Nginx web server with SSL',
    config: {
      version: '1.24',
      ssl: true,
      domains: ['example.com', 'www.example.com']
    },
    tags: ['nginx', 'web', 'ssl']
  },
  {
    id: 'apache-server',
    type: 'apache',
    name: 'Apache Web Server',
    description: 'Apache web server with virtual hosts',
    config: {
      version: '2.4',
      ssl: true,
      virtual_hosts: ['example.com', 'www.example.com']
    },
    tags: ['apache', 'web', 'virtual-hosts']
  },
  {
    id: 'ftp-server',
    type: 'ftp',
    name: 'FTP Server',
    description: 'vsftpd FTP server',
    config: {
      type: 'vsftpd',
      port: 21
    },
    tags: ['ftp', 'file-transfer']
  },
  {
    id: 'database-postgresql',
    type: 'database',
    name: 'PostgreSQL Database',
    description: 'PostgreSQL database server',
    config: {
      type: 'PostgreSQL',
      version: '15',
      port: 5432
    },
    tags: ['database', 'postgresql', 'sql']
  },
  {
    id: 'database-mysql',
    type: 'database',
    name: 'MySQL Database',
    description: 'MySQL database server',
    config: {
      type: 'MySQL',
      version: '8.0',
      port: 3306
    },
    tags: ['database', 'mysql', 'sql']
  },
  {
    id: 'mail-server',
    type: 'mail',
    name: 'Postfix Mail Server',
    description: 'Postfix mail server with SSL',
    config: {
      type: 'Postfix',
      domains: ['example.com'],
      ssl: true
    },
    tags: ['mail', 'postfix', 'email']
  },
  {
    id: 'dns-server',
    type: 'dns',
    name: 'BIND DNS Server',
    description: 'BIND DNS server with zones',
    config: {
      type: 'BIND',
      zones: ['example.com'],
      forwarders: ['8.8.8.8', '8.8.4.4']
    },
    tags: ['dns', 'bind', 'domain']
  },
  {
    id: 'vpn-server',
    type: 'vpn',
    name: 'OpenVPN Server',
    description: 'OpenVPN server for secure access',
    config: {
      type: 'OpenVPN',
      port: 1194
    },
    tags: ['vpn', 'openvpn', 'security']
  }
])

const selectedTags = ref([])
const searchQuery = ref('')

const availableTags = computed(() => {
  const tags = new Set()
  inventoryItems.value.forEach(item => {
    item.tags.forEach(tag => tags.add(tag))
  })
  return Array.from(tags).sort()
})

const filteredItems = computed(() => {
  return inventoryItems.value.filter(item => {
    const matchesSearch = !searchQuery.value ||
      item.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.value.toLowerCase())

    const matchesTags = selectedTags.value.length === 0 ||
      selectedTags.value.some(tag => item.tags.includes(tag))

    return matchesSearch && matchesTags
  })
})

const toggleTag = (tag) => {
  const index = selectedTags.value.indexOf(tag)
  if (index > -1) {
    selectedTags.value.splice(index, 1)
  } else {
    selectedTags.value.push(tag)
  }
}

const getTypeIcon = (type) => {
  const icons = {
    // VM Types
    'vm-windows': '🪟',
    'vm-linux': '🐧',
    'vm-freebsd': '👹',
    'vm-macos': '🍎',

    // Network Types
    'network': '🌐',
    'subnet': '🔗',
    'router': '🛣️',
    'firewall': '🔥',
    'load-balancer': '⚖️',

    // Application Types
    'docker': '🐳',
    'nginx': '🌐',
    'apache': '🦅',
    'ftp': '📁',
    'database': '🗄️',
    'mail': '📧',
    'dns': '🔍',
    'vpn': '🔒'
  }
  return icons[type] || '📦'
}

const getTypeColor = (type) => {
  const colors = {
    // VM Types
    'vm-windows': 'badge-primary',
    'vm-linux': 'badge-success',
    'vm-freebsd': 'badge-error',
    'vm-macos': 'badge-neutral',

    // Network Types
    'network': 'badge-secondary',
    'subnet': 'badge-info',
    'router': 'badge-warning',
    'firewall': 'badge-error',
    'load-balancer': 'badge-warning',

    // Application Types
    'docker': 'badge-accent',
    'nginx': 'badge-success',
    'apache': 'badge-warning',
    'ftp': 'badge-neutral',
    'database': 'badge-primary',
    'mail': 'badge-secondary',
    'dns': 'badge-info',
    'vpn': 'badge-success'
  }
  return colors[type] || 'badge-neutral'
}

const getTypeCategory = (type) => {
  if (type.startsWith('vm-')) return 'Proxmox'
  if (['network', 'subnet', 'router', 'firewall', 'load-balancer'].includes(type)) return 'Network'
  return 'Applications'
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Enhanced Header -->
    <div class="navbar bg-base-100 border-b border-base-300 shadow-sm">
      <div class="flex-1">
        <h2 class="text-lg font-semibold text-base-content">Infrastructure Inventory</h2>
        <p class="text-xs text-base-content/70">Browse and manage reusable infrastructure templates</p>
      </div>
      <div class="flex-none gap-2">
        <button class="btn btn-primary btn-sm">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
          </svg>
          Add Template
        </button>
      </div>
    </div>

    <!-- Enhanced Filters -->
    <div class="p-4 bg-base-200 border-b border-base-300">
      <div class="flex flex-wrap gap-4 items-center">
        <div class="form-control">
          <div class="input-group">
            <span class="btn btn-square btn-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
            </span>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search templates..."
              class="input input-bordered input-sm w-64"
            />
          </div>
        </div>

        <div class="flex gap-2 items-center">
          <span class="text-sm font-medium text-base-content/70">Filter by:</span>
          <div class="flex gap-1 flex-wrap">
            <button
              v-for="tag in availableTags"
              :key="tag"
              @click="toggleTag(tag)"
              :class="[
                'badge badge-sm',
                selectedTags.includes(tag) ? 'badge-primary' : 'badge-outline'
              ]"
            >
              {{ tag }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Enhanced Inventory Grid -->
    <div class="flex-1 p-4 overflow-auto">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div
          v-for="item in filteredItems"
          :key="item.id"
          class="card bg-base-100 shadow-lg hover:shadow-xl transition-all duration-200 cursor-pointer group"
        >
          <div class="card-body">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <div class="flex-shrink-0">
                  <span class="text-3xl">{{ getTypeIcon(item.type) }}</span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <div class="badge" :class="getTypeColor(item.type)">
                      {{ item.type }}
                    </div>
                    <div class="badge badge-outline badge-xs">
                      {{ getTypeCategory(item.type) }}
                    </div>
                  </div>
                  <h3 class="card-title text-sm">{{ item.name }}</h3>
                  <p class="text-xs text-base-content/70 line-clamp-2">{{ item.description }}</p>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap gap-1 mt-3">
              <span
                v-for="tag in item.tags"
                :key="tag"
                class="badge badge-xs badge-outline"
              >
                {{ tag }}
              </span>
            </div>

            <div class="card-actions justify-end mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <button class="btn btn-primary btn-xs">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
                </svg>
                Use Template
              </button>
              <button class="btn btn-ghost btn-xs">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                </svg>
                Edit
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="filteredItems.length === 0" class="text-center py-12">
        <div class="text-6xl mb-4 opacity-20">📦</div>
        <h3 class="text-xl font-semibold mb-2 text-base-content/70">No templates found</h3>
        <p class="text-base-content/50 mb-4">
          Try adjusting your search or filter criteria
        </p>
        <button class="btn btn-primary">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
          </svg>
          Create New Template
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  transition: all 0.2s ease-in-out;
}

.card:hover {
  transform: translateY(-2px);
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
