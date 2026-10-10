# range42-deployer-ui

A web interface for designing, customizing, and deploying Proxmox cyber range
scenarios. Part of the [Range42](https://github.com/range42/range42) platform.

## How it works

Build a topology on the VueFlow canvas or open a ready-made scenario from
[range42-playbooks](https://github.com/range42/range42-playbooks) or a compatible
private repository. Git-bound projects save a revision that the
[backend API](https://github.com/range42/range42-backend-api) checks and executes.
The backend owns deployment attempts, credentials, and runner recovery; the UI
shows preflight results, progress, and logs.

```text
Operator browser
    |
range42-deployer-ui <----> Public forks / private Git repositories
    |
    | REST + server-sent events, through Kong when configured
    v
range42-backend-api ----> Saved scenario playbooks ----> Proxmox / SDN
```

## Key features

- **Visual topology editor:** configure guests, SDN networks, replication, and
  catalog attachments; review validation before generating a concrete scenario.
- **Ready-made scenarios:** fork public repositories or connect private ones,
  edit scenario files and shared dependencies, and select declared features and
  parameters. Deploy through an existing Range42 context. See
  [ready-made scenario deployment](docs/native-scenarios.md).
- **Git authoring:** save working branches, publish revisions, and reopen projects
  with their repository files. See the [Git workflow](docs/git-authoring-workflow.md).
- **Deployment monitoring:** inspect preflight checks, attempts, logs, and live
  events; request cancellation through the backend. Available lifecycle actions
  depend on the scenario and target capabilities.
- **Infrastructure inspection:** browse registered hosts, import existing guests,
  and review supported runtime changes and snapshot operations. See the
  [UI/backend capability matrix](docs/ui-backend-capability-matrix.md).
- **Project dashboard:** search, duplicate, and manage projects with a persistent
  local editing state and Git-backed saved revisions.

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
| Unit tests | Vitest + Vue Test Utils |
| Browser tests | Playwright |

## Getting Started

### Prerequisites

- Node.js `^20.19.0`, `^22.12.0`, or `^24.0.0` for local development; CI and the
  Docker builder use Node 24.
- A reachable Range42 backend API with the target Proxmox hosts registered.
- For ready-made scenario execution, existing Range42 contexts exposed by the
  backend. See [scenario deployment prerequisites](docs/native-scenarios.md).

### Deploy `dev_deployer_ui_lab` with range42-context

Use the existing Range42 init and scenario workflow to create the Proxmox lab
and install the backend API and deployer UI. The scenario creates three
development guests: `dev-deployer-ui`, `dev-backend` and `dev-kong`. Wazuh, MISP
and Tailscale are optional features.

Before running `init`, select matching repository revisions in the deployer's
repository root (normally `~/range42`). The wizard discovers scenarios from the
`range42-playbooks` checkout beside the core repository; the scenario manifest
and all four setup templates must already exist there. Its automatic clone of
`main` does not guarantee the current scenario and installer fixes are available.

For the current showcase review build, use these refs:

| Repository | Ref |
| --- | --- |
| `range42` | `dev` |
| `range42-playbooks` | `fix/dev-deployer-ui-bootstrap-20261009` ([PR #179](https://github.com/range42/range42-playbooks/pull/179)) |
| `range42-backend-api` | `fix/context-bootstrap-20261009` ([PR #156](https://github.com/range42/range42-backend-api/pull/156)) |
| `range42-deployer-ui` | `fix/context-bootstrap-20261009` ([PR #118](https://github.com/range42/range42-deployer-ui/pull/118)) |

After those PRs merge, use the destination branch containing their changes. An
API/UI promotion alone does not include the playbooks fix.

For a fresh default repository root:

```zsh
mkdir -p "$HOME/range42"
git clone --branch dev https://github.com/range42/range42.git "$HOME/range42/range42"
git clone --branch fix/dev-deployer-ui-bootstrap-20261009 https://github.com/range42/range42-playbooks.git "$HOME/range42/range42-playbooks"
git clone --branch fix/context-bootstrap-20261009 https://github.com/range42/range42-backend-api.git "$HOME/range42/range42-backend-api"
git clone --branch fix/context-bootstrap-20261009 https://github.com/range42/range42-deployer-ui.git "$HOME/range42/range42-deployer-ui"
```

For existing checkouts, preserve local edits, fetch the remote refs and select
the same revisions before continuing. Use the actual repository root shown by
`range42-context status` rather than the default path if it differs.

On an existing deployer, initialize the workspace:

```zsh
range42-context init
```

Select your infrastructure codename, enter the Proxmox connection details and
actual node name, and choose `dev_deployer_ui_lab`. The wizard's **Deploy now**
bootstraps the deployer, inventory, encrypted vault and SSH keys. It prepares the
workspace; the following command deploys the scenario guests and applications.
For a new deployer, run `./range42-init.py` from the selected core checkout
as described in the [Range42 setup guide](https://github.com/range42/range42/blob/dev/GETTING_STARTED.md).

Open a new zsh session. Bootstrap can select `main` in the shared repository
checkouts, so recheck the refs before deploying. For the review build above:

```zsh
RANGE42_SOURCE_ROOT="$HOME/range42" # Use the root selected in the wizard.
git -C "$RANGE42_SOURCE_ROOT/range42" switch dev
git -C "$RANGE42_SOURCE_ROOT/range42-playbooks" switch fix/dev-deployer-ui-bootstrap-20261009
git -C "$RANGE42_SOURCE_ROOT/range42-backend-api" switch fix/context-bootstrap-20261009
git -C "$RANGE42_SOURCE_ROOT/range42-deployer-ui" switch fix/context-bootstrap-20261009
# Load the CLI from the matching core checkout in this session.
source "$RANGE42_SOURCE_ROOT/range42/roles/deployer.bootstrap/files/range42-context.sh"
# Replace pve01 with the codename chosen in the wizard.
range42-context use pve01 dev_deployer_ui_lab
range42-context status
range42-context deploy
```

The application installers build these selected checkouts. The updated backend
installer resolves its immutable image ID automatically, provisions its private API credentials once,
and preserves managed state on a repeat deployment. The UI receives this lab's
backend URL and the node selected during setup. No manual `BACKEND_IMAGE` is needed
for the normal source deployment. The playbooks installer update must accompany
these application revisions when promoting them to `dev` or `main`.

Optional machine-specific application settings belong in
`$RANGE42_ACTIVE_CONFIG_DIR/deployment.yml`. The scenario reads this file
automatically; command-line `-e` overrides take precedence. For example:

```yaml
API_PORT: 8000
UI_PORT: 3000
BACKEND_INSTALL_ROOT: /var/lib/range42-backend
```

For an existing managed backend, retain its recorded installation root, private
credentials and execution-runtime bindings. `BACKEND_IMAGE` is an optional pin for
a reviewed image already present on the backend guest. Without that pin, the
installer builds the selected source and uses a guarded update when it changes.
Full scenario execution through the API also requires a complete reviewed runtime,
a private credential template and a matching registered Proxmox target; see
[scenario deployment prerequisites](docs/native-scenarios.md) and
[backend runtime packaging](https://github.com/range42/range42-backend-api/blob/dev/docs/container-packaging.md).
The source-build fix handles application installation; it does not export a new
execution runtime or auto-register Proxmox credentials.

The default UI is `http://192.168.142.190:3000` on the lab network and the API is
`http://192.168.142.191:8000`. Use your configured proxy URL when accessing the
showcase externally. In **Settings → Backend API hosts**, enter the backend's
private bearer token and check its readiness. The public `/health` (UI) and
`/v1/health` (API) endpoints confirm startup; API readiness requires authentication.

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

The multi-stage `Dockerfile` uses **Debian bookworm** for both the builder and runtime stages.
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
npm ci

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

## Project structure

```text
src/
├── components/             # Canvas, catalog, and deployment controls
│   ├── nodes/              # VueFlow node components
│   └── deployment/         # Runtime controls, allocations, snapshots
├── composables/            # Editor, Git, catalog, and infrastructure workflows
├── services/
│   ├── git/                # GitHub, GitLab, and Gitea providers
│   ├── projectRepo/        # Project files and revision persistence
│   └── proxmox/            # Backend-mediated infrastructure operations
├── stores/                 # Projects, backend hosts, sources, and preferences
├── views/                  # Dashboard, editor, catalog, settings, deployments
├── i18n/                   # Locale setup and loading
└── locales/                # English, French, and Japanese translations
```

## Data and storage

| Data | Storage |
|---|---|
| Local projects and editing preferences | Browser storage |
| Saved scenario files and project revisions | Connected Git repositories |
| Backend connections and Git source preferences | Browser storage scoped by the relevant connection |
| Deployment attempts, logs, allocations, and runtime state | Backend API |

See [Git project reopening](docs/git-project-reopening.md) for how saved
repositories and local drafts are restored.

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

Docs: see `docs/i18n-guide.md` for structure, conventions, and acceptance tests.

## Testing

```bash
# Unit tests
npm run test:unit -- --run

# Lint without changing source files
npx eslint .

# Check application and migrated modules
npm run typecheck:migrated
npm run test:typecheck

# Browser tests
npm run test:e2e
```

## Contributing

See the [Range42](https://github.com/range42/range42) root repository for
platform-wide contribution context.

## License

GPL-3.0 — see [LICENSE](LICENSE).
