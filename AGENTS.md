# Repository Guidelines

## Project Structure & Module Organization
The Vite-powered Vue 3 app lives in `src/`, with pages under `src/views`, reusable UI in `src/components`, and shared logic in `src/composables` and `src/stores` (Pinia). Route definitions are centralized in `src/router`, localization assets sit in `src/locales/<lang>`, and validation helpers are kept in `src/rules`. Unit specs reside in `src/__tests__`, Playwright scenarios in `e2e/`, and design references in `docs/`. Static assets are served from `public/`, while Tailwind and global styles start in `src/main.css`.

## Build, Test, and Development Commands
- `npm run dev` — launch Vite with hot-module reloading at `http://localhost:5173`.
- `npm run build` — create an optimized production bundle in `dist/`.
- `npm run preview` — preview the built bundle locally before shipping.
- `npm run lint` — apply ESLint autofixes across Vue, JS, and test files.
- `npm run test:unit` — execute Vitest specs (headless via jsdom).
- `npm run test:e2e` — run Playwright against the built app; add `--ui` for interactive debugging.

## Coding Style & Naming Conventions
Follow the ESLint + `eslint-plugin-vue` ruleset defined in `eslint.config.js`; files are formatted with 2-space indentation, single quotes, and trailing commas where possible. Vue SFCs belong in PascalCase filenames (`NodePanel.vue`), composables export camelCase hooks from `src/composables`, and Pinia stores expose `use<Thing>Store`. Keep route names kebab-cased to align with existing entries, and prefer Tailwind utility classes for layout before adding custom CSS.

## Testing Guidelines
Unit tests should mirror component filenames (e.g., `App.vue` → `App.spec.js`) and cover rendering logic plus Pinia actions. When modifying workflows or navigation, extend the Playwright coverage in `e2e/i18n.spec.ts` or add new `.spec.ts` files. Keep snapshots deterministic and run `npm run test:unit && npm run test:e2e` locally before raising a PR.

## Commit & Pull Request Guidelines
Commits follow a Conventional Commits pattern (`feat:`, `chore:`, `fix:`) as seen in the history; keep messages in the imperative and scope changes narrowly. PRs should summarize intent, link any Range42 tracker issue, outline testing performed, and include UI screenshots or GIFs when altering layouts. Ensure linting and both test suites pass, and call out any new configuration steps (for example, changes under `src/config/database.js`).

## Configuration & Data Handling
Runtime configuration is centralized under `src/config` and uses browser storage (`useProjectStore`) for persistence; update the store helpers when adding new project metadata so export/import remains stable. Sensitive defaults belong in environment variables surfaced through Vite’s `import.meta.env`—never hard-code credentials or endpoints in components.
