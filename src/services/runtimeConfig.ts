/**
 * Deployment-time runtime configuration.
 *
 * The deploy bundle (`bundles/admin/software.install.deployer_ui`) renders a
 * `config.json` into the SPA's `public/` dir before the Docker build, so vite
 * copies it verbatim into `dist/` and nginx serves it next to `index.html`.
 * Reading it at boot lets one image be pointed at any backend without a
 * rebuild — the alternative (a `VITE_*` build arg) bakes the lab's IP into the
 * image.
 *
 * Absent or malformed file is NOT an error: `npm run dev` and any hand-built
 * image simply have no `config.json`, and the operator configures the backend
 * from the Settings modal as before.
 */
export interface RuntimeConfig {
  /** Backend API base URL to register on first launch, e.g. `http://10.0.0.5:8000`. */
  defaultBackendUrl?: string
  /** Proxmox node that backend targets; falls back to the store's default. */
  defaultNodeName?: string
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig | null> {
  try {
    const res = await fetch('/config.json', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as RuntimeConfig
  } catch {
    return null
  }
}
