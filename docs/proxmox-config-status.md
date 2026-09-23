# Infrastructure configuration and target binding

Imported VM/LXC configuration has an explicit **Review changes → Apply Changes**
flow for name, description, CPU cores, memory and tags. Editing these values or
refreshing actual configuration preserves local desired edits. The five legacy
v0 setters remain blocked; tag edits never autosync.

Review reads fresh current and configured values from the selected registered
host through `GET /v1/proxmox/hosts/{host}/vms/{vmid}/config/review`. The comparison
shows only the displayed desired changes that differ from configured values;
already pending values are not submitted twice. Apply sends one partial patch
to `PUT .../config` with the opaque review digest. A changed backend, credential,
selected guest, desired edit or closed dialog invalidates the review.

The backend checks the original host registration and Proxmox configuration
revision, permissions, protection policy and ownership before dispatch. Templates,
locked guests, protected VMIDs and deployment-managed guests are refused. See the
[API contract](https://github.com/range42/range42-backend-api/blob/feat/shared-sdn-workflow-20260910/docs/imported-vm-configuration.md)
for limits and errors. This workflow does not replace pinned deployment Configure.

A synchronous result requires matching fresh readback. An asynchronous result
requires the original host's task to stop successfully, then matching fresh
configuration. Task polling and readback retain the review's target fingerprint;
re-registering the host cannot attribute an old task to a replacement server.
Lost responses, failures, changed targets or mismatched values remain unconfirmed
and require a fresh review before retrying. No start, stop or restart is sent.

**Current** means Proxmox's current configuration, not measured guest state.
**Configured** includes pending changes. CPU/memory may still require restart,
hotplug or guest cooperation. Only a complete current observation replaces the
local actual snapshot; configured resources never become optimistically actual.

“Refresh actual configuration” remains available independently. It reads the
exact VMID/type/node and explicit host ID when supplied, updates only observed
name, cores, memory, tags and description, and preserves desired edits. Missing
targets, incomplete responses and late reads leave observations unchanged.

V1 lifecycle, configuration, snapshots and storage resolve fresh host registrations.
They require a complete listing (currently at most the endpoint's 100-row first
page), an exact intended node and an unambiguous match. An explicit host ID can
disambiguate duplicate node names; callers without one refuse ambiguity. Lookup
and action retain the same backend URL and bearer context. These checks grant
no additional permissions and do not prevent external Proxmox writers.

Other legacy network/firewall/create adapters remain separate. This change does
not establish target binding for every older operation or implement scenario
snapshot/reset recovery, disk/NIC editing or template creation.

Validation includes real client HTTP contracts, reactive Vue reviews, stale and
late responses, queued resources and production-browser desktop/mobile flows
with controlled services and accessibility checks. Live configuration writes
require separate acceptance; local validation changes no shared guests.
