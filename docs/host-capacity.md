# Measured Proxmox host capacity

In a project, open the settings menu and choose **Proxmox Settings**. Select a
saved backend connection, enter the Proxmox node, then choose **Load capacity**.
This reads the selected connection with its saved API token, independently of
the application's globally active backend. Add or edit backend tokens in Settings.

The panel lists registered Proxmox targets from that backend whose node matches
the form. A single match is initially selected; multiple matches require an
explicit choice. **Refresh capacity** reloads registrations and measurements. A
removed target clears the preview and must be selected again. Reading capacity
does not save the project configuration or select a deployment target.

The matching backend must provide authenticated
`GET /v1/proxmox/hosts?offset=…&limit=100` and
`GET /v1/proxmox/hosts/{host_id}/capacity`. Missing route support, rejected tokens,
permission failures and unreachable backends have explicit error messages.
Listings above 1,000 targets are rejected rather than silently truncated.

CPU hardware counts and current utilization are separate measurements. They do
not report exclusive free cores or a per-user quota. RAM and each visible storage
pool show total, used and free bytes using binary units; the exact byte value is
available on the measurement's tooltip. Pools are not summed because backing
storage can be shared. Unknown values display **Unknown**, while measured zero
remains zero. Partial/unavailable reports retain readable measurements and show
the backend's diagnostic messages and limits. An empty storage list does not
imply zero capacity because Proxmox permissions can hide pools.

Backend ID, URL, token or node changes clear results and abort pending reads.
Target changes also invalidate prior requests; late responses cannot restore
stale values. Responses must match the requested host and node, and malformed
measurements are rejected. The observation time is displayed in local time.
Measurements are not reservations. The backend's concrete deployment preflight
compares the plan with current capacity again before a full deployment.

Validation includes service and component context-switch/authentication tests,
explicit target selection, pagination, null and zero values, failed refresh,
unmount cancellation, and a desktop/mobile browser flow with WCAG 2.0/2.1 AA axe
checks, keyboard refresh and no dialog horizontal overflow. The browser flow
uses a simulated backend and does not mutate Proxmox.
