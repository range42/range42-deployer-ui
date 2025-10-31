# Framework Direction Notes

- Current app is heavily invested in Vue 3: single-file components, Pinia persistence, vue-i18n, and VueFlow composables underpin the project editor and state management.
- Migrating to React/Next would require rewriting every interactive surface (drag/drop nodes, modals, export flows) and rebuilding the data layer without a strong automated-test safety net.
- VueFlow covers the canvas needs today; React Flow would offer a parallel API but still forces a fresh implementation and QA cycle.
- Next.js advantages (SSR/SSG, edge APIs) have limited impact for this canvas-centric tool that already ships quickly via Vite.
- Recommendation: treat Vue as the committed path, shore up the existing implementation (missing runnerCalls, tests, UX polish), and only prototype React if leadership mandates ecosystem consolidation.
