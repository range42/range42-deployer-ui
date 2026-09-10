# Scenario resource reservations

The scenario editor can reserve VM IDs and IPv4 addresses against a selected backend target. Entered values are explicit requests and are never silently replaced. Empty fields retain the same project's existing assignment when available; otherwise the backend selects a free value. Review the returned mapping before applying it, then save the scenario.

Reservations last one hour by default. Renewing checks occupancy again. If a lease expires, the same browser can request it again; values applied to the draft are sent explicitly, so a newly occupied value produces an error rather than a silent reassignment. Releasing a reservation does not erase draft values or change Proxmox resources. Deployment still performs its own preflight.

The browser generates an ownership token and stores it locally, scoped to the backend URL, target host and local project ID. Retries reuse that token, including after a lost response. Only reservation metadata and assignments enter scenario data; the token is sent in `X-Range42-Reservation-Token` and must never be written to Git. Another browser cannot manage that lease without its original local ownership state; it must wait for expiry or use the original browser.

The backend accepts up to 64 VMs, 32 declared networks, 32 NICs per VM and 256 NICs overall. Networks must be nonoverlapping canonical IPv4 /16–/30 subnets with bridge names no longer than 15 characters. Automatic searches inspect at most 4,096 VM ID candidates and 4,096 address candidates. Manual VM IDs are independent of the automatic range. Protected IDs, visible occupied resources and active reservations are excluded.

Reservations conservatively share VM IDs and `(bridge, IP)` pairs across all host registrations on one backend installation, preventing aliases from bypassing the ledger. Truly separate clusters therefore cannot reuse those values on that installation until cluster identity is modeled explicitly. Static addresses outside the backend's visible guest configuration can remain undetectable; the response's limitation messages are shown with the mapping.

The deployment form prefers the saved target only when its backend URL matches the current backend and that target still exists. Changing backend or target displays a reminder to reserve again. The initial scope is one target node with explicitly declared subnets; team replication and automatic subnet allocation are separate features.

API: `POST /v1/proxmox/hosts/{host_id}/reservations` reserves or renews; `GET` and `DELETE /v1/proxmox/hosts/{host_id}/reservations/{reservation_id}` restore and release using the same ownership header. Project keys are local authoring IDs and do not require a registered Git project.
