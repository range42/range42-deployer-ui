import { ref, computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { generateTopologyExport } from '../rules/topologyRules'
import { zipSync, strToU8 } from 'fflate'

export function useExport() {
  const { getNodes, getEdges } = useVueFlow()
  const isExporting = ref(false)
  const exportErrors = ref([])

  // Analyze node relationships for Proxmox deployment
  const analyzeInfrastructure = (nodes, edges) => {
    const analysis = {
      networks: [],
      hosts: [],
      services: [],
      dependencies: new Map(),
      deploymentGroups: new Map(),
      networkingConfig: new Map()
    }

    // Build dependency graph
    edges.forEach(edge => {
      if (!analysis.dependencies.has(edge.target)) {
        analysis.dependencies.set(edge.target, new Set())
      }
      analysis.dependencies.get(edge.target).add(edge.source)
    })

    nodes.forEach(node => {
      switch (node.type) {
        case 'network-segment':
          analysis.networks.push(node)
          break
        case 'vm':
          analysis.hosts.push(node)
          break
        case 'docker':
        case 'dns':
        case 'dhcp':
        case 'loadbalancer':
          analysis.services.push(node)
          break
        case 'router':
        case 'switch':
        case 'firewall':
          analysis.networkingConfig.set(node.id, node)
          break
      }
    })

    // Group services by their host VMs
    analysis.services.forEach(service => {
      const dependencies = analysis.dependencies.get(service.id) || new Set()
      const hostVMs = [...dependencies].map(depId => 
        nodes.find(n => n.id === depId && n.type === 'vm')
      ).filter(Boolean)

      if (hostVMs.length > 0) {
        const hostVM = hostVMs[0] // Use first VM if multiple
        if (!analysis.deploymentGroups.has(hostVM.id)) {
          analysis.deploymentGroups.set(hostVM.id, {
            host: hostVM,
            services: [],
            networks: []
          })
        }
        analysis.deploymentGroups.get(hostVM.id).services.push(service)
      }
    })

    // Map networks to deployment groups
    analysis.networks.forEach(network => {
      const networkDependencies = analysis.dependencies.get(network.id) || new Set()
      networkDependencies.forEach(depId => {
        const deploymentGroup = analysis.deploymentGroups.get(depId)
        if (deploymentGroup && !deploymentGroup.networks.includes(network)) {
          deploymentGroup.networks.push(network)
        }
      })
    })

    return analysis
  }

  // Validate configuration completeness
  const validateConfiguration = (nodes) => {
    const errors = []
    
    nodes.forEach(node => {
      const config = node.data?.config || {}
      
      // Common validations
      if (!config.name?.trim()) {
        errors.push(`${node.type} node requires a name`)
      }

      // Type-specific validations
      switch (node.type) {
        case 'vm':
          if (!config.cpu || config.cpu < 1) {
            errors.push(`VM "${config.name}" requires valid CPU configuration`)
          }
          if (!config.memory?.trim()) {
            errors.push(`VM "${config.name}" requires memory specification`)
          }
          break
        case 'docker':
          if (!config.image?.trim()) {
            errors.push(`Container "${config.name}" requires Docker image`)
          }
          break
        case 'network-segment':
          if (!config.cidr?.trim()) {
            errors.push(`Network "${config.name}" requires CIDR range`)
          }
          break
      }
    })

    return errors
  }

  // Generate Proxmox VM provisioning playbook
  const generateProxmoxPlaybook = (analysis) => {
    const playbook = {
      name: 'Deploy Range42 Infrastructure on Proxmox',
      hosts: 'proxmox_hosts',
      gather_facts: false,
      vars: {
        proxmox_api_host: '{{ proxmox_host }}',
        proxmox_api_user: '{{ proxmox_user }}',
        proxmox_api_password: '{{ proxmox_password }}',
        proxmox_node: '{{ proxmox_node_name }}',
        vm_template: '{{ base_template | default("ubuntu-22.04-template") }}',
        ssh_public_key: '{{ lookup("file", ssh_key_path) }}'
      },
      tasks: []
    }

    // Create VMs
    analysis.hosts.forEach((host, index) => {
      const config = host.data.config || {}
      const vmName = config.name || `vm-${index}`
      const vmid = 100 + index // Starting VMID

      playbook.tasks.push({
        name: `Create VM: ${vmName}`,
        'community.general.proxmox_kvm': {
          api_host: '{{ proxmox_api_host }}',
          api_user: '{{ proxmox_api_user }}',
          api_password: '{{ proxmox_api_password }}',
          node: '{{ proxmox_node }}',
          name: vmName,
          vmid: vmid,
          clone: '{{ vm_template }}',
          full: true,
          format: 'qcow2',
          storage: '{{ vm_storage | default("local-lvm") }}',
          cores: parseInt(config.cpu) || 2,
          memory: parseInt(config.memory?.replace(/[^0-9]/g, '')) * 1024 || 2048,
          net: {
            net0: 'virtio,bridge={{ network_bridge | default("vmbr0") }}'
          },
          ide: {
            ide2: '{{ vm_storage | default("local-lvm") }}:cloudinit'
          },
          ciuser: '{{ vm_user | default("ubuntu") }}',
          cipassword: '{{ vm_password | default("ubuntu") }}',
          sshkeys: '{{ ssh_public_key }}',
          ipconfig: {
            ipconfig0: 'ip=dhcp'
          },
          state: 'present'
        },
        register: `vm_${vmName.replace(/[^a-zA-Z0-9]/g, '_')}_result`
      })

      playbook.tasks.push({
        name: `Start VM: ${vmName}`,
        'community.general.proxmox_kvm': {
          api_host: '{{ proxmox_api_host }}',
          api_user: '{{ proxmox_api_user }}',
          api_password: '{{ proxmox_api_password }}',
          node: '{{ proxmox_node }}',
          vmid: vmid,
          state: 'started'
        }
      })
    })

    // Wait for VMs to be ready
    playbook.tasks.push({
      name: 'Wait for VMs to be ready',
      pause: {
        seconds: 30
      }
    })

    return playbook
  }

  // Generate service deployment playbook
  const generateServicePlaybook = (analysis) => {
    const playbook = {
      name: 'Deploy Services on Range42 Infrastructure',
      hosts: 'range42_vms',
      become: true,
      gather_facts: true,
      vars: {
        docker_packages: [
          'docker.io',
          'docker-compose-plugin',
          'python3-docker'
        ]
      },
      tasks: [
        {
          name: 'Update apt cache',
          apt: {
            update_cache: true,
            cache_valid_time: 3600
          }
        },
        {
          name: 'Install Docker and dependencies',
          apt: {
            name: '{{ docker_packages }}',
            state: 'present'
          }
        },
        {
          name: 'Start and enable Docker service',
          systemd: {
            name: 'docker',
            state: 'started',
            enabled: true
          }
        },
        {
          name: 'Add user to docker group',
          user: {
            name: '{{ ansible_user }}',
            groups: 'docker',
            append: true
          }
        },
        {
          name: 'Create service directories',
          file: {
            path: '/opt/range42/{{ inventory_hostname }}',
            state: 'directory',
            mode: '0755'
          }
        }
      ]
    }

    // Deploy services per host
    analysis.deploymentGroups.forEach((group, hostId) => {
      const hostName = group.host.data.config.name || `vm-${hostId}`
      
      if (group.services.length > 0) {
        playbook.tasks.push({
          name: `Deploy Docker Compose for ${hostName}`,
          copy: {
            content: '{{ docker_compose_content }}',
            dest: `/opt/range42/${hostName}/docker-compose.yml`,
            mode: '0644'
          },
          vars: {
            docker_compose_content: '{{ lookup("file", "docker-compose/" + inventory_hostname + ".yml") }}'
          },
          when: `inventory_hostname == "${hostName}"`
        })

        playbook.tasks.push({
          name: `Start services on ${hostName}`,
          'community.docker.docker_compose': {
            project_src: `/opt/range42/${hostName}`,
            state: 'present',
            pull: true
          },
          when: `inventory_hostname == "${hostName}"`
        })
      }
    })

    return playbook
  }

  // Generate Docker Compose files for each VM
  const generateDockerComposeFiles = (analysis) => {
    const composeFiles = new Map()

    analysis.deploymentGroups.forEach((group, hostId) => {
      const { host, services, networks } = group
      const hostName = host.data.config.name || `vm-${hostId}`
      
      const compose = {
        version: '3.8',
        services: {},
        networks: {},
        volumes: {}
      }

      // Add custom networks based on network segments
      networks.forEach(network => {
        const networkConfig = network.data.config || {}
        const networkName = networkConfig.name?.toLowerCase().replace(/\s+/g, '_') || 'default'
        
        compose.networks[networkName] = {
          driver: 'bridge'
        }

        if (networkConfig.cidr) {
          compose.networks[networkName].ipam = {
            config: [{
              subnet: networkConfig.cidr,
              gateway: networkConfig.gateway
            }]
          }
        }
      })

      // Add default network if no custom networks
      if (Object.keys(compose.networks).length === 0) {
        compose.networks.default = { driver: 'bridge' }
      }

      // Add services
      services.forEach(service => {
        const config = service.data.config || {}
        const serviceName = config.name?.toLowerCase().replace(/\s+/g, '_') || service.id

        if (service.type === 'docker') {
          compose.services[serviceName] = {
            image: config.image,
            container_name: serviceName,
            restart: 'unless-stopped'
          }

          // Add ports
          if (config.ports) {
            compose.services[serviceName].ports = config.ports
              .split(',')
              .map(p => p.trim())
              .filter(p => p)
          }

          // Add environment variables
          if (config.env) {
            compose.services[serviceName].environment = config.env
              .split('\n')
              .map(line => line.trim())
              .filter(line => line && line.includes('='))
          }

          // Add to networks
          if (networks.length > 0) {
            compose.services[serviceName].networks = [
              networks[0].data.config.name?.toLowerCase().replace(/\s+/g, '_') || 'default'
            ]
          }
        }
        
        // Handle infrastructure services
        else if (service.type === 'dns') {
          compose.services[serviceName] = {
            image: 'coredns/coredns:latest',
            container_name: serviceName,
            restart: 'unless-stopped',
            ports: ['53:53/udp', '53:53/tcp'],
            volumes: ['./coredns:/etc/coredns:ro'],
            command: ['-conf', '/etc/coredns/Corefile']
          }
        }
        
        else if (service.type === 'dhcp') {
          compose.services[serviceName] = {
            image: 'networkboot/dhcpd:latest',
            container_name: serviceName,
            restart: 'unless-stopped',
            network_mode: 'host',
            volumes: ['./dhcp:/data'],
            environment: ['INTERFACES=eth0']
          }
        }
        
        else if (service.type === 'loadbalancer') {
          compose.services[serviceName] = {
            image: 'nginx:alpine',
            container_name: serviceName,
            restart: 'unless-stopped',
            ports: ['80:80', '443:443'],
            volumes: [
              './nginx/nginx.conf:/etc/nginx/nginx.conf:ro',
              './nginx/certs:/etc/nginx/certs:ro'
            ]
          }
        }

        // Add to networks
        if (networks.length > 0 && compose.services[serviceName]) {
          compose.services[serviceName].networks = [
            networks[0].data.config.name?.toLowerCase().replace(/\s+/g, '_') || 'default'
          ]
        }
      })

      composeFiles.set(hostName, {
        filename: `${hostName}.yml`,
        content: generateYAML(compose)
      })
    })

    return composeFiles
  }

  // Generate Ansible inventory
  const generateInventory = (analysis) => {
    const inventory = {
      all: {
        vars: {
          ansible_user: 'ubuntu',
          ansible_ssh_private_key_file: '~/.ssh/id_rsa',
          ansible_ssh_common_args: '-o StrictHostKeyChecking=no'
        },
        children: {
          proxmox_hosts: {
            hosts: {
              proxmox_server: {
                ansible_host: 'REPLACE_WITH_PROXMOX_IP',
                proxmox_host: 'REPLACE_WITH_PROXMOX_IP',
                proxmox_user: 'root@pam',
                proxmox_password: 'REPLACE_WITH_PASSWORD',
                proxmox_node_name: 'REPLACE_WITH_NODE_NAME'
              }
            }
          },
          range42_vms: {
            hosts: {}
          }
        }
      }
    }

    // Add VMs to inventory
    analysis.hosts.forEach(host => {
      const config = host.data.config || {}
      const hostName = config.name || host.id
      
      inventory.all.children.range42_vms.hosts[hostName] = {
        ansible_host: 'REPLACE_WITH_VM_IP',
        vm_specs: {
          cpu: config.cpu || 2,
          memory: config.memory || '2GB',
          os: config.os || 'Ubuntu 22.04'
        }
      }
    })

    return inventory
  }

  // Generate configuration files for services
  const generateServiceConfigs = (analysis) => {
    const configs = new Map()

    analysis.services.forEach(service => {
      const serviceConfig = service.data.config || {}
      
      if (service.type === 'dns' && serviceConfig.zones) {
        // Generate CoreDNS Corefile
        let corefile = `. {
    forward . ${serviceConfig.forwarders?.join(' ') || '8.8.8.8 1.1.1.1'}
    log
    errors
}`

        serviceConfig.zones.forEach(zone => {
          if (zone.name && zone.type === 'forward') {
            corefile = `${zone.name} {
    file /etc/coredns/db.${zone.name}
    log
    errors
}

` + corefile
          }
        })

        configs.set(`coredns/Corefile`, { content: corefile })
      }
      
      else if (service.type === 'loadbalancer') {
        // Generate Nginx configuration
        const nginxConf = `events {
    worker_connections 1024;
}

http {
    upstream backend {
        ${serviceConfig.servers?.map(server => 
          `server ${server.ip}:${server.port} weight=${server.weight || 1};`
        ).join('\n        ') || 'server 127.0.0.1:8080;'}
    }

    server {
        listen 80;
        server_name _;

        location / {
            proxy_pass http://backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
    }
}`
        configs.set(`nginx/nginx.conf`, { content: nginxConf })
      }
    })

    return configs
  }

  // Simple YAML generator
  const generateYAML = (obj, indent = 0) => {
    const spaces = '  '.repeat(indent)
    let yaml = ''

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        yaml += `${spaces}${key}: null\n`
      } else if (Array.isArray(value)) {
        yaml += `${spaces}${key}:\n`
        value.forEach(item => {
          if (typeof item === 'object') {
            yaml += `${spaces}  -\n${generateYAML(item, indent + 2).replace(/^/gm, '    ')}`
          } else {
            yaml += `${spaces}  - ${item}\n`
          }
        })
      } else if (typeof value === 'object') {
        yaml += `${spaces}${key}:\n`
        yaml += generateYAML(value, indent + 1)
      } else {
        yaml += `${spaces}${key}: ${value}\n`
      }
    }

    return yaml
  }

  // Main export function
  const exportProject = async (project, format = 'all', override = {}) => {
    isExporting.value = true
    exportErrors.value = []

    try {
      const vfNodes = (getNodes && Array.isArray(getNodes.value)) ? getNodes.value : []
      const vfEdges = (getEdges && Array.isArray(getEdges.value)) ? getEdges.value : []
      const nodes = (override && Array.isArray(override.nodes) && override.nodes.length) ? override.nodes 
        : (vfNodes && vfNodes.length ? vfNodes 
        : (project && Array.isArray(project.nodes) ? project.nodes : []))
      const edges = (override && Array.isArray(override.edges) && override.edges.length) ? override.edges 
        : (vfEdges && vfEdges.length ? vfEdges 
        : (project && Array.isArray(project.edges) ? project.edges : []))

      // Validate configuration
      const validationErrors = validateConfiguration(nodes)
      if (validationErrors.length > 0) {
        // Do not abort export; include warnings in metadata and continue
        exportErrors.value = validationErrors
      }

      // Analyze infrastructure
      const analysis = analyzeInfrastructure(nodes, edges)
      // Build topology JSON via rules engine
      const topology = generateTopologyExport(nodes, edges)

      const exports = {
        metadata: {
          projectName: project.name,
          exportedAt: new Date().toISOString(),
          nodeCount: nodes.length,
          edgeCount: edges.length,
          deployment: 'proxmox-ansible',
          valid: (validationErrors.length === 0),
          validationErrors
        },
        analysis,
        topology,
        topologyJson: JSON.stringify(topology, null, 2)
      }

      // Generate Ansible playbooks
      exports.ansible = {
        'proxmox-provision.yml': {
          content: generateYAML([generateProxmoxPlaybook(analysis)])
        },
        'deploy-services.yml': {
          content: generateYAML([generateServicePlaybook(analysis)])
        },
        'inventory.yml': {
          content: generateYAML(generateInventory(analysis))
        }
      }

      // Generate Docker Compose files
      if (format === 'docker-compose' || format === 'all') {
        exports.dockerCompose = generateDockerComposeFiles(analysis)
      }

      // Generate service configuration files
      exports.configs = generateServiceConfigs(analysis)

      // Generate deployment documentation
      exports.documentation = generateDeploymentDocs(analysis)

      return exports

    } catch (error) {
      exportErrors.value = [error.message]
      return null
    } finally {
      isExporting.value = false
    }
  }

  // Generate deployment documentation
  const generateDeploymentDocs = (analysis) => {
    const lines = []

    lines.push(
      '# Range42 Infrastructure Deployment Guide',
      '',
      '## Overview',
      'This deployment uses Proxmox VE for virtualization and Ansible for automation.',
      '',
      '### Infrastructure Summary',
      '- **VMs**: ' + analysis.hosts.length,
      '- **Services**: ' + analysis.services.length,
      '- **Networks**: ' + analysis.networks.length,
      '- **Networking Components**: ' + analysis.networkingConfig.size,
      '',
      '## Prerequisites',
      '',
      '### Proxmox Setup',
      '- Proxmox VE 8.0+ installed and configured',
      '- VM template created (Ubuntu 22.04 LTS recommended)',
      '- Storage configured for VM disks',
      '- Network bridge configured (vmbr0)',
      '',
      '### Ansible Control Machine',
      '~~~bash',
      '# Install Ansible and required collections',
      'pip3 install ansible',
      'ansible-galaxy collection install community.general',
      'ansible-galaxy collection install community.docker',
      '~~~',
      '',
      '### SSH Key Setup',
      '~~~bash',
      '# Generate SSH key if you don\'t have one',
      'ssh-keygen -t rsa -b 4096 -C "your_email@example.com"',
      '~~~',
      '',
      '## Configuration',
      '',
      '### 1. Update Inventory',
      'Edit inventory.yml and replace placeholders:',
      '- REPLACE_WITH_PROXMOX_IP: Your Proxmox server IP',
      '- REPLACE_WITH_PASSWORD: Your Proxmox root password',
      '- REPLACE_WITH_NODE_NAME: Your Proxmox node name',
      '- REPLACE_WITH_VM_IP: VM IP addresses (after creation)',
      '',
      '### 2. VM Template Requirements',
      'Your VM template should have:',
      '- Cloud-init support enabled',
      '- SSH server installed',
      '- Python 3 installed',
      '- Qemu guest agent installed',
      '',
      '## Deployment Steps',
      '',
      '### Step 1: Create VMs on Proxmox',
      '~~~bash',
      'ansible-playbook -i inventory.yml proxmox-provision.yml',
      '~~~',
      '',
      '### Step 2: Update VM IPs in Inventory',
      'After VMs are created, check their IP addresses in Proxmox and update inventory.yml.',
      '',
      '### Step 3: Deploy Services',
      '~~~bash',
      'ansible-playbook -i inventory.yml deploy-services.yml',
      '~~~',
      '',
      '## Service Architecture'
    )

    // Document each deployment group
    analysis.deploymentGroups.forEach((group, hostId) => {
      const hostConfig = group.host.data.config || {}
      const hostName = hostConfig.name || ('VM-' + hostId)

      lines.push(
        '',
        '### ' + hostName,
        '- **CPU**: ' + (hostConfig.cpu || 2) + ' cores',
        '- **Memory**: ' + (hostConfig.memory || '2GB'),
        '- **OS**: ' + (hostConfig.os || 'Ubuntu 22.04'),
        '',
        '**Services:**'
      )

      group.services.forEach(service => {
        const serviceConfig = service.data.config || {}
        lines.push('- **' + (serviceConfig.name || service.id) + '** (' + service.type + ')')
        if (service.type === 'docker' && serviceConfig.image) {
          lines.push('  - Image: ' + serviceConfig.image)
          if (serviceConfig.ports) {
            lines.push('  - Ports: ' + serviceConfig.ports)
          }
        }
      })

      if (group.networks.length > 0) {
        lines.push('', '**Networks:**')
        group.networks.forEach(network => {
          const networkConfig = network.data.config || {}
          lines.push('- ' + (networkConfig.name || 'Network') + ' (' + (networkConfig.cidr || '') + ')')
        })
      }
    })

    lines.push(
      '',
      '## Troubleshooting',
      '',
      '### VM Creation Issues',
      '- Check Proxmox credentials and node name',
      '- Verify template exists and is properly configured',
      '- Ensure sufficient storage space',
      '',
      '### Service Deployment Issues',
      '- Verify VMs are accessible via SSH',
      '- Check Docker installation status',
      '- Review container logs: docker logs <container_name>',
      '',
      '### Network Issues',
      '- Verify Proxmox bridge configuration',
      '- Check VM network settings',
      '- Test connectivity between services',
      '',
      '## Management Commands',
      '',
      '### Check Service Status',
      '~~~bash',
      '# On each VM',
      'docker ps',
      'docker-compose ps',
      '~~~',
      '',
      '### View Service Logs',
      '~~~bash',
      '# On each VM',
      'docker-compose logs -f',
      '~~~',
      '',
      '### Update Services',
      '~~~bash',
      '# Re-run service deployment',
      'ansible-playbook -i inventory.yml deploy-services.yml',
      '~~~'
    )

    return lines.join('\n')
  }

  // Download export as zip (fflate)
  const downloadExport = async (exportData, projectName) => {
    const files = {}

    // Documentation and metadata
    files['README.md'] = strToU8(exportData.documentation || '')
    files['metadata.json'] = strToU8(JSON.stringify(exportData.metadata, null, 2))
    if (exportData.topology || exportData.topologyJson) {
      files['topology.json'] = strToU8(exportData.topologyJson || JSON.stringify(exportData.topology, null, 2))
    }

    // Ansible files
    if (exportData.ansible) {
      Object.entries(exportData.ansible).forEach(([filename, file]) => {
        files['ansible/' + filename] = strToU8(file.content || '')
      })
    }

    // Docker Compose files (Map)
    if (exportData.dockerCompose) {
      exportData.dockerCompose.forEach((file, key) => {
        const name = file.filename || key
        files['docker-compose/' + name] = strToU8(file.content || '')
      })
    }

    // Service configs (Map)
    if (exportData.configs) {
      exportData.configs.forEach((file, key) => {
        files['configs/' + key] = strToU8(file.content || '')
      })
    }

    // Scripts
    files['scripts/deploy.sh'] = strToU8([
      '#!/bin/bash',
      'set -e',
      '',
      'echo "🚀 Starting Range42 Infrastructure Deployment"',
      '',
      '# Check prerequisites',
      'echo "Checking prerequisites..."',
      'command -v ansible >/dev/null 2>&1 || { echo "❌ Ansible is required but not installed. Aborting." >&2; exit 1; }',
      '',
      '# Step 1: Provision VMs',
      'echo "📦 Step 1: Creating VMs on Proxmox..."',
      'cd ansible/',
      'ansible-playbook -i inventory.yml proxmox-provision.yml',
      '',
      'echo "⏳ Waiting for VMs to be ready..."',
      'sleep 60',
      '',
      '# Step 2: Deploy services',
      'echo "🐳 Step 2: Deploying services..."',
      'ansible-playbook -i inventory.yml deploy-services.yml',
      '',
      'echo "✅ Deployment complete!"',
      'echo "📋 Check the README.md for post-deployment steps."'
    ].join('\n'))

    files['scripts/cleanup.sh'] = strToU8([
      '#!/bin/bash',
      'set -e',
      '',
      'echo "🧹 Cleaning up Range42 Infrastructure"',
      '',
      'cd ansible/',
      'ansible-playbook -i inventory.yml proxmox-provision.yml --extra-vars "state=absent"',
      '',
      'echo "✅ Cleanup complete!"'
    ].join('\n'))

    // Zip and download
    const zipped = zipSync(files, { level: 6 })
    const blob = new Blob([zipped], { type: 'application/zip' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = projectName + '-proxmox-deployment-' + Date.now() + '.zip'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  return {
    isExporting: computed(() => isExporting.value),
    exportErrors: computed(() => exportErrors.value),
    exportProject,
    downloadExport,
    validateConfiguration,
    analyzeInfrastructure
  }
}