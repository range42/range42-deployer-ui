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

### Current Implementation Status

✅ **Completed Features:**
- VueFlow canvas with node-based infrastructure design
- Three node types: Virtual Machines, Networks, Docker Containers
- Status indicators (gray, orange, red, green)
- Node configuration panels with type-specific settings
- Sidebar navigation using DaisyUI drawer
- Project data persistence using localStorage
- Export/Import functionality for project data
- Inventory system with reusable templates
- Responsive design with mobile support

🔄 **In Progress:**
- SQLite WASM integration for robust data storage
- Deployment orchestration backend
- Advanced node validation and error handling

📋 **Planned Features:**
- Real-time collaboration
- Advanced deployment tracking
- Infrastructure validation and testing
- Cloud provider integrations

## 🎨 Node Types

### Virtual Machine (VM)
- **Icon**: 🖥️
- **Configuration**: Name, CPU cores, Memory, Disk size
- **Status**: Tracks deployment readiness

### Network
- **Icon**: 🌐
- **Configuration**: Name, CIDR range, Gateway
- **Status**: Network connectivity validation

### Docker Container
- **Icon**: 🐳
- **Configuration**: Name, Image, Ports, Environment variables
- **Status**: Container deployment status

## 📊 Data Structure

Projects are stored as JSON with the following structure:

```json
{
  "id": "project-1234567890",
  "name": "Infrastructure Project",
  "created": "2024-01-01T00:00:00.000Z",
  "modified": "2024-01-01T00:00:00.000Z",
  "nodes": [
    {
      "id": "node-1",
      "type": "vm",
      "position": { "x": 100, "y": 100 },
      "data": {
        "type": "vm",
        "label": "Virtual Machine",
        "status": "gray",
        "config": {
          "name": "Web Server",
          "cpu": 2,
          "memory": "4GB",
          "disk": "20GB"
        }
      }
    }
  ],
  "edges": []
}
```

## 🛠️ Technology Stack

- **Frontend**: Vue 3 with Composition API
- **UI Framework**: DaisyUI (Tailwind CSS)
- **Flow Editor**: VueFlow
- **Build Tool**: Vite
- **Data Storage**: localStorage (SQLite WASM planned)
- **Testing**: Vitest
- **Linting**: ESLint

## 📝 Development Guidelines

See `.cursor/rules/development-workflow.mdc` for detailed development guidelines, testing strategies, and code quality standards.
