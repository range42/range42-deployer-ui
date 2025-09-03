# range42-deployer

**range42-deployer** is a web application designed to visually orchestrate and manage infrastructure through an intuitive interface powered by **VueFlow**. The primary goal of this project is to enable users to build, configure, and deploy complex infrastructure systems using a node-based visual editor.

## 🔧 Node-Based Infrastructure Design

Users interact with a canvas where each node represents a component of the infrastructure (e.g., networks, VMs, Docker containers). Each node's behavior and configuration depend on its type:

* **Settings**: Nodes require user input to define parameters essential for backend deployment.
* **Status Indicators**: Each node is marked with a colored status indicator:

  * **Gray**: Incomplete / missing required configuration.
  * **Orange**: Ready to deploy.
  * **Red**: Deployment error or misconfiguration.
  * **Green**: Successfully deployed.

## 🌐 UI/UX Principles

* Built using **VueFlow** for seamless node manipulation and interactions.
* Leverages **DaisyUI** for styling and component consistency.
* Adheres to **UI/UX best practices**, focusing on clarity, responsiveness, and accessibility.

## 💾 Data Management

The application uses **localStorage** to store and manage local project data directly in the browser, ensuring quick access and offline capabilities. Future versions will integrate SQLite WASM for more robust data persistence.

## 📁 Project Structure & Data Scope

* Each **Project** corresponds to a VueFlow workspace and is stored as a JSON object.
* Projects include all configuration data needed to build and deploy infrastructure.
* A **shared inventory system** exists across all projects, containing pre-made, pre-configured components (like base Docker images, VM templates, or network presets) for reuse and standardization.

## 🧩 Key Features

* Visual drag-and-drop interface to define and manage infrastructure.
* Per-node configuration system with validation.
* Deployment tracking and feedback via status indicators.
* Persistent local storage using localStorage.
* Project isolation with shared global data for reusability.
* Sidebar navigation with responsive design.

## 🚀 Getting Started

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🌍 Internationalization (i18n)

- The app uses `vue-i18n` with per-page/component JSON files under `src/locales/<lang>/...`.
- Default and fallback locale is English (`en`). French (`fr`) is provided as a proof of concept.
- Language can be switched at runtime from the sidebar language selector.

Development notes:
- i18n runtime is initialized in `src/i18n/index.js` with secure lazy-loading via `import.meta.glob`.
- Supported locales are defined in `src/i18n/supported.js`.
- When adding a new page/component, create a JSON file under each locale using the same filename.
- Avoid using `v-html` for translated strings; keep translations as plain text.

Docs: see `docs/i18n-plan.md` for structure, conventions, and acceptance tests.
