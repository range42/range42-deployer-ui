# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Range42 Deployer UI** is a Vue 3 web application that provides a visual interface for designing and orchestrating cyber range infrastructure using a node-based editor powered by VueFlow. Users can drag and drop infrastructure components (VMs, networks, Docker containers, services) onto a canvas, configure them, and generate deployment-ready topology JSON files.

This application is part of the Range42 ecosystem, which includes:
- Deployer UI (this project) - visual interface for infrastructure design
- Deployer backend API - orchestrates deployments by executing playbooks
- Catalog - Ansible roles and Docker stacks
- Playbooks - centralized deployment automation

## Tech Stack

- **Vue 3** with Composition API
- **VueFlow** for node-based visual editor
- **Pinia** for state management
- **Vue Router** for navigation
- **Vue I18n** for internationalization
- **TailwindCSS 4** + **DaisyUI** for styling
- **Vite** for build tooling
- **Vitest** for unit tests
- **Playwright** for e2e tests

## Common Commands

### Development
```bash
# Install dependencies
npm install

# Start dev server (runs on http://0.0.0.0:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Testing
```bash
# Run unit tests (Vitest)
npm run test:unit

# Run unit tests in watch mode
npm run test:unit -- --watch

# Run e2e tests (Playwright)
npm run test:e2e

# Run e2e tests with UI
npm run test:e2e:ui
```

### Linting
```bash
# Run ESLint with auto-fix
npm run lint
```

## Architecture

### State Management

**Pinia Store: `projectStore`** (`src/stores/projectStore.js`)
- Manages all projects using localStorage (key: `range42_projects`)
- Each project contains: id, name, created/modified timestamps, nodes[], edges[]
- Operations: createProject, getProject, updateProject, deleteProject, exportProject, clearAllData
- Projects are loaded on app mount via `loadProjects()`

### Routing Structure

Three main routes (`src/router/index.js`):
1. **Dashboard** (`/`) - List all projects, create new projects
2. **ProjectEditor** (`/project/:id`) - VueFlow canvas for designing infrastructure
3. **Settings** (`/settings`) - Application settings (Proxmox config, etc.)

### Data Flow

1. **Project Data**: Stored in localStorage via Pinia store
2. **VueFlow State**: Managed by composables using VueFlow's reactive APIs
3. **Node/Edge Updates**: Flow through VueFlow event handlers → composables → Pinia store
4. **Persistence**: Auto-saved to localStorage on every project modification

### Key Composables

**`useInfraBuilder`** (`src/composables/useInfraBuilder.js`)
- Core VueFlow state management
- Handles node/edge changes via applyNodeChanges/applyEdgeChanges
- Manages node selection and status updates
- Loads/syncs project data with VueFlow canvas

**`useExport`** (`src/composables/useExport.js`)
- Generates topology JSON from VueFlow nodes/edges
- Uses topologyRules to apply IP assignment logic
- Exports metadata (counts, timestamps)
- Handles download of topology.json files

**`useProjectData`** (`src/composables/useProjectData.js`)
- Syncs VueFlow state with Pinia store
- Auto-saves project changes
- Manages project lifecycle

**`useDragAndDrop`** (`src/composables/useDragAndDrop.js`)
- Handles drag-and-drop of infrastructure components from sidebar to canvas
- Creates new nodes with default configurations

**`useProxmoxSettings`** (`src/composables/useProxmoxSettings.js`)
- Manages project-level Proxmox configuration
- Stores settings in project.data.proxmox via localStorage

### Infrastructure Node Types

Located in `src/components/nodes/`:
- **NetworkSegmentNode** - Network segments with CIDR, gateway, VLAN
- **InfraNodeVm** - Virtual machines
- **InfraNodeDocker** - Docker containers
- **InfraNodeDns** - DNS servers
- **InfraNodeDhcp** - DHCP servers
- **InfraNodeRouter** - Routers
- **InfraNodeFirewall** - Firewalls
- **InfraNodeSwitch** - Network switches
- **InfraNodeLoadBalancer** - Load balancers
- **InfraNodeNetwork** - Generic network nodes

Each node has:
- **Status indicator** (gray=incomplete, orange=ready, green=deployed, red=error)
- **Configuration panel** (accessed via ConfigPanel component)
- **Parent-child relationships** (nodes can be nested inside network segments)

### Topology Export Rules

**`topologyRules.js`** (`src/rules/topologyRules.js`)
- Builds deployment-ready topology JSON from VueFlow graph
- Applies IP assignment logic:
  - If DHCP service present in network → assign method: 'dhcp'
  - If no DHCP → assign static IPs from CIDR range (starting at .10)
  - Reserves gateway IP and .1-.9 range for infrastructure
- Tracks network membership via parentNode relationships
- Exports: nodes, edges, networks, hosts, services, rules, metadata

## Internationalization

**Language Support**: English (default), French, Japanese

**Structure**: Lazy-loaded namespaces per component/page
- Locale files: `src/locales/<locale>/<namespace>.json`
- Example namespaces: `common`, `sidebar`, `configPanel`, `export`
- Runtime: `src/i18n/index.js` with `vue-i18n`
- Supported locales: `src/i18n/supported.js`

**Loading Translations**:
```js
import { ensureNamespaces } from '@/i18n/index.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n({ useScope: 'global' })
onMounted(() => ensureNamespaces(['sidebar', 'common']))
```

**Switching Locale**:
```js
import { setLocale } from '@/i18n/index.js'
await setLocale('fr', ['sidebar', 'common'])
```

For detailed i18n guidance, see `docs/i18n-guide.md`.

## Vite Configuration Notes

**Special Headers** (`vite.config.js`):
- Sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
- Required for future SQLite WASM integration
- Excludes `@sqlite.org/sqlite-wasm` from optimization

**Dev Server**:
- Runs on `0.0.0.0:3000` (accessible on network)
- Hot reload enabled
- Vue DevTools plugin included

## Component Patterns

### Node Status Management
Nodes track deployment status via `node.data.status`:
```js
updateNodeStatus(nodeId, { status: 'ready', config: { /* updates */ } })
```

### Parent-Child Relationships
Infrastructure components can be nested in network segments:
```js
node.parentNode = networkSegmentId
```
This creates visual containment in VueFlow and logical membership in topology export.

### Configuration Panels
Each node type has a settings form shown in ConfigPanel when selected. Config is stored in `node.data.config`.

## File Alias

Use `@` as alias for `src/`:
```js
import { useProjectStore } from '@/stores/projectStore'
```

## Development Notes

- Node/edge changes must flow through VueFlow's change handlers (applyNodeChanges/applyEdgeChanges) to maintain reactivity
- Always use `ensureNamespaces()` before rendering components with translated strings to avoid missing translation warnings
- Project data persistence happens automatically via Pinia store watchers - no manual save calls needed
- When adding new infrastructure node types, update `topologyRules.js` to handle export logic
