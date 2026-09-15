
# Table of Contents

- [Project Overview](#Project-Overview)
- [Repository Content](#Repository-Content)
- [Getting Started](#Getting-Started)
- [Contributing](#Contributing)
- [License](#License)

---

# Project Overview

**RANGE42** is a modular cyber range platform designed for real-world readiness.
We build, deploy, and document offensive, defensive, and hybrid cyber training environments using reproducible, infrastructure-as-code methodologies.

## What we build

- Proxmox-based cyber ranges with dynamic catalog 
- Ansible roles for automated deployments (Wazuh, Kong, Docker, etc.)
- Private APIs for range orchestration and telemetry
- Developer and testing toolkits and JSON transformers for automation pipelines
- ...

## Repository Overview

- **RANGE42 deployer UI** : A web interface to visually design infrastructure schemas and trigger deployments.
- **RANGE42 deployer backend API** : Orchestrates deployments by executing playbooks and bundles from the catalog.
- **RANGE42 catalog** : A collection of Ansible roles and Docker/Docker Compose stacks, forming deployable bundles.
- **RANGE42 playbooks** : Centralized playbooks that can be invoked by the backend or CLI.
- **RANGE42 proxmox role** : An Ansible role for controlling Proxmox nodes via the Proxmox API.
- **RANGE42 devkit** : Helper scripts for testing, debugging, and development workflows.
- **RANGE42 kong API gateway** : A network service in front of the backend API, handling authentication, ACLs, and access control policies.
- **RANGE42 swagger API spec** : OpenAPI/Swagger JSON definition of the backend API.

---

### Putting it all together

These repositories provide a modular and extensible platform to design, manage and deploy infrastructures automatically  either from the UI (coming soon) or from the CLI through the playbooks repository.

# Repository Content

**range42-deployer-ui** is a web application designed to visually orchestrate and manage infrastructure through an intuitive interface powered by **VueFlow**. The primary goal of this project is to enable users to build, configure, and deploy complex infrastructure systems using a node-based visual editor.

## Node-Based Infrastructure Design

Users interact with a canvas where each node represents a component of the infrastructure (e.g., networks, VMs, Docker containers). Each node's behavior and configuration depend on its type:

* **Settings**: Nodes require user input to define parameters essential for backend deployment.
* **Status Indicators**: Each node is marked with a colored status indicator:

  * **Gray**: Incomplete / missing required configuration.
  * **Orange**: Ready to deploy.
  * **Red**: Deployment error or misconfiguration.
  * **Green**: Successfully deployed.

## UI/UX Principles

* Built using **VueFlow** for seamless node manipulation and interactions.
* Leverages **DaisyUI** for styling and component consistency.
* Adheres to **UI/UX best practices**, focusing on clarity, responsiveness, and accessibility.

## Data Management

The application uses **localStorage** to store and manage local project data directly in the browser, ensuring quick access and offline capabilities. Future versions will integrate SQLite WASM for more robust data persistence.

## Project Structure & Data Scope

* Each **Project** corresponds to a VueFlow workspace and is stored as a JSON object.
* Projects include all configuration data needed to build and deploy infrastructure.
* A **shared inventory system** exists across all projects, containing pre-made, pre-configured components (like base Docker images, VM templates, or network presets) for reuse and standardization.

## Key Features

* Visual drag-and-drop interface to define and manage infrastructure.
* Per-node configuration system with validation.
* Deployment tracking and feedback via status indicators.
* Persistent local storage using localStorage.
* Project isolation with shared global data for reusability.
* Sidebar navigation with responsive design.

## Getting Started

### Docker

```bash
cp .env.example .env
docker compose up --build
```

The UI is available at `http://localhost:3000` (configurable via `UI_PORT` in `.env`).

Configure and select the backend API URL in **Settings → Backend API hosts**,
then open **Git Sources** to connect the recommended public Range42 catalog.
No Git token is required for the default repository. See
[catalog onboarding](docs/catalog-onboarding.md) for custom repositories,
credentials, and deployment prerequisites.

Git-bound projects save edits to a dedicated working branch. See the
[Git authoring workflow](docs/git-authoring-workflow.md) for publishing the same
snapshot to public and private repositories, creating Ansible roles, and the
[concrete scenario authoring workflow](docs/concrete-scenario-authoring.md) for
SDN, VM bootstrap, guest content updates and deployment VM teardown.

### Docker: Build & Push

The multi-stage `Dockerfile` uses **Debian stable (bookworm)** for both the builder and runtime stages.
Stage 1 runs `npm ci` + `npm run build` to produce the production bundle.
Stage 2 serves the compiled SPA with nginx.

**Build locally and validate:**

```bash
# Build and start (image tested via the /health endpoint)
docker compose up --build

# Confirm the container is healthy
docker compose ps
```

**Build and tag for a registry:**

```bash
IMAGE=ghcr.io/range42/range42-deployer-ui
TAG=$(git rev-parse --short HEAD)

docker build -t "${IMAGE}:${TAG}" -t "${IMAGE}:latest" .
```

**Push to the registry:**

```bash
docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:latest"
```

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Check application Vue/TypeScript before building
npm run typecheck

# Check explicitly migrated JavaScript modules and Vue scripts
npm run typecheck:migrated

# Verify checker coverage and its JavaScript boundary
npm run test:typecheck

# Build for production
npm run build

# Preview production build
npm run preview
```

The application checker includes every implementation `.ts`, `.tsx` and `.vue`
file under `src`, with strict TypeScript and template checks for TypeScript SFCs.
Existing JavaScript is included for module inference (`allowJs: true`) but is not
checked by default (`checkJs: false`), including JavaScript-script Vue components.
The explicit `typecheck-migrated.json` list opts reviewed files into `@ts-check`. Tests and
tooling are outside this application configuration. See [typecheck coverage](docs/typechecking.md)
for the exact boundary; a successful Vite build is not a typecheck.

## Navigation and appearance

The sidebar groups Projects, Catalog and Deployments under Workspace, with
Sources and Settings under Manage. Collapse it explicitly to keep more canvas
space; the preference survives navigation and reload. Smaller screens use
separate navigation and project-tools drawers.

Project components can be clicked or dragged onto the canvas. Search project,
Undo, Redo and Save are visible controls; app-specific keyboard shortcuts and
their badges have been removed. Standard keyboard navigation and editor text
editing remain available. Settings → Appearance selects System, Light or Dark
and remembers the choice.

See [navigation design and acceptance](docs/navigation-design.md) for interaction
details, screenshots and the limits of the browser checks.

## Internationalization (i18n)

- The app uses `vue-i18n` with per-page/component JSON files under `src/locales/<lang>/...`.
- Default and fallback locale is English (`en`). French (`fr`) is provided as a proof of concept.
- Language can be switched at runtime from the project sidebar language selector
  (inside Project tools on smaller screens). The redesigned navigation and
  component palette have English, French and Japanese strings.

Development notes:
- i18n runtime is initialized in `src/i18n/index.js` with secure lazy-loading via `import.meta.glob`.
- Supported locales are defined in `src/i18n/supported.js`.
- When adding a new page/component, create a JSON file under each locale using the same filename.
- Avoid using `v-html` for translated strings; keep translations as plain text.

Docs: see `docs/i18n-plan.md` for structure, conventions, and acceptance tests.


## Contributing

To be defined.

## License

- GPL-3.0 license
