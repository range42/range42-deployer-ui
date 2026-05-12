
# range42-deployer-ui

A web interface to visually design infrastructure topologies and trigger deployments against a live Proxmox cluster.
Part of the [range42](https://github.com/range42/range42) cyber range platform.

---

## How it works

The deployer UI is the operator's cockpit for the range42 platform. Users build infrastructure topologies on a node-based canvas — each node is a typed component (VM, LXC container, network segment, router, firewall, group). Once a topology is configured, the UI dispatches a step-by-step deployment plan to the [range42-backend-api](https://github.com/range42/range42-backend-api), which executes Ansible playbooks from the [range42-playbooks](https://github.com/range42/range42-playbooks) repository against the target Proxmox cluster.

```
Operator browser
    │
    ▼
range42-deployer-ui   ──── reads/writes ────►  GitHub inventory repos
    │
    │  REST (via range42-backend-api)
    ▼
range42-backend-api  ──── invokes ────►  range42-playbooks  ──── controls ────►  Proxmox
                      ◄─── Kong API gateway (auth / ACL / rate-limiting) ──────────┘
```

---

## Key Features

### Visual topology editor

- Drag-and-drop canvas powered by **VueFlow**.
- Node types: `vm`, `lxc`, `network-segment`, `router`, `edge-firewall`, `group`, `switch`, `dns`, `dhcp`, `load-balancer`, `vuln-target`, `gamenet`, and more.
- Per-node configuration panels with live validation.
- Node status indicators updated in real time from Proxmox polling:
  - **Gray** — incomplete / missing required config.
  - **Orange** — ready to deploy.
  - **Green** — deployed and running.
  - **Red** — deployment error or misconfiguration.
- Topology validation before deployment with detailed error reporting.

### Deployment engine

- Sequential step-by-step plan execution: `create_bridge` → `create_vm` → `clone_template` → `create_lxc` → `configure_network` → `add_firewall_rule` → `start_vm` → `start_lxc`.
- Pause mid-deployment (completes the current step first).
- Cancel via `AbortController`.
- Resume from the last completed step.
- Retry or skip individual failed steps without restarting.
- Real-time log stream with `info`, `success`, `warning`, `error` levels.

### Infrastructure import

Import live Proxmox resources directly onto the canvas: connect to a Proxmox node, browse running VMs and LXC containers with their real-time status (running / stopped / paused), select one or many, and add them as configured nodes.

### Template & ISO browser

Browse Proxmox storage pools for LXC templates and ISO images, filter by name, and trigger ISO downloads by URL — all from within the project editor.

### Git-backed inventory

The inventory system connects to external GitHub repositories as component catalogs. Each registered inventory repo exposes a `manifest.json` with typed components (`vms/`, `networks/`, `services/`, `scenarios/`). The UI can read from read-only repos or, with a GitHub token, write new components, delete entries, or fork a read-only catalog to a personal namespace.

### VM lifecycle management

Per-node runtime controls for start, stop, pause, resume, snapshot creation, snapshot revert, and delete — scoped per role category (admin, student, vuln).

### Project management dashboard

Grid/list view toggle, project search and filter, per-project node stats (total, running, ready, error), project duplication, and confirmed-delete flow.

---

## Tech stack

| Layer | Library |
|---|---|
| UI framework | Vue 3 |
| Canvas | VueFlow |
| Styling | Tailwind CSS v4 + DaisyUI |
| State | Pinia |
| Router | Vue Router |
| i18n | vue-i18n |
| Build | Vite |
| Unit tests | Vitest + @vue/test-utils |
| E2E tests | Playwright |
| Storage (WIP) | @sqlite.org/sqlite-wasm (OPFS) |

---

## Getting Started

### Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`
- A running [range42-backend-api](https://github.com/range42/range42-backend-api) instance reachable from the browser
- A Proxmox node registered in the backend API

### Install and run

```bash
# Install dependencies
npm install

# Start development server (default: http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Connect to the backend

On first launch, open **Settings → Proxmox** (or the settings icon in the sidebar) and enter the backend API URL and Proxmox node name. These settings are stored per-project as browser cookies (`range42.settings.<projectId>`, 30-day TTL).

---

## Project structure

```
src/
├── components/
│   ├── nodes/              # VueFlow custom node types
│   ├── ConfigPanel.vue     # Per-node configuration panel
│   ├── DeploymentPanel.vue # Step-by-step deployment UI
│   ├── InfrastructureImportModal.vue
│   ├── TemplateBrowser.vue
│   ├── InventoryBrowser.vue
│   └── ...
├── composables/
│   ├── useDeployment.ts    # Deployment engine (pause/cancel/resume/retry/skip)
│   ├── useProxmoxStatus.ts # Real-time Proxmox polling
│   ├── useProxmoxStorage.ts
│   ├── useInfrastructureImport.ts
│   ├── useTopologyResolver.ts
│   └── runnerCalls/        # Typed step executors per node category
├── services/
│   ├── proxmox/api.ts      # Full Proxmox API client (VM/LXC/network/firewall/storage/snapshots)
│   └── git/                # GitHub provider for inventory read/write
├── stores/
│   ├── deploymentStore.ts
│   ├── inventoryStore.ts   # Git-backed multi-repo catalog
│   └── proxmoxSettingsStore.ts
├── views/
│   ├── Dashboard.vue       # Project management hub
│   ├── ProjectEditor.vue   # Canvas + topology editor
│   └── Settings.vue        # App settings (theme, grid, storage)
├── i18n/                   # vue-i18n setup and locale loader
└── locales/                # en / fr / jp translation files
```

---

## Data and storage

| Data | Storage |
|---|---|
| Project topology (nodes + edges) | `localStorage` |
| Per-project backend settings | Browser cookie (`range42.settings.<projectId>`, 30-day TTL) |
| Inventory repo list | `localStorage` |
| SQLite WASM (OPFS) | Dependency installed, browser-local DB integration in progress |

---

## Internationalization

Supported locales: **English** (`en`), **Français** (`fr`), **日本語** (`jp`).

Language can be switched at runtime from the sidebar. Translations live in `src/locales/<locale>/<namespace>.json` and are lazy-loaded per view/component.

See [docs/i18n-guide.md](docs/i18n-guide.md) for conventions, namespace structure, and how to add a new language.

---

## Testing

```bash
# Unit tests (Vitest)
npm run test:unit

# End-to-end tests (Playwright)
npm run test:e2e

# Lint
npm run lint
```

---

## Contributing

Work in progress. See the [range42](https://github.com/range42/range42) root repo for platform-wide contribution context.

## License

GPL-3.0 — see [LICENSE](LICENSE).
