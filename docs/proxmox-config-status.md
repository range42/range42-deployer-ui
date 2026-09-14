# Infrastructure configuration and target binding

The UI preserves desired VM/LXC configuration edits and shows them as pending.
**Apply is unavailable** until the API provides configuration writes bound to a
registered Proxmox host. Tag edits are also local desired edits; they do not
autosync. The five legacy configuration setters refuse before any HTTP request.

The existing `/v0/admin/proxmox/vms/vm_id/config/*` handlers resolve the backend's
global Ansible inventory. Their node argument does not bind the request to a
registered host ID/API URL. The current authenticated v1 interface has a guest
configuration read endpoint, but no equivalent host-bound configuration write.
Enabling Apply requires that API contract plus permission checks, accepted-task
tracking and actual readback. HTTP acceptance alone must not mark desired values
as actual values. Other legacy network/firewall/create adapters are outside this
bounded change; this is not a claim that every older operation is host-bound.

“Refresh actual configuration” reads the selected VMID/type/node through v1 and
updates only observed name, cores, memory, tags and description. It preserves
desired edits. Missing target, incomplete response, backend/credential change or
late response after closing/switching the dialog leaves observations unchanged.

V1 lifecycle, config reads, snapshots and storage operations resolve fresh host
registrations. They require a complete listing (currently at most the endpoint's
100-row first page), an exact intended node and an unambiguous match. An explicit
host ID can disambiguate registrations with the same node name; current callers
without such a selector refuse that ambiguity. Without an explicit node, the
matching saved backend's node is used, or a sole registration if no default
exists. Missing/duplicate/partial registrations refuse rather than select row one.

Lookup and action retain the same backend URL and bearer context. Task polling
uses the node in the UPID and the original backend/credential guard; switching
context or omitting the task ID cannot confirm success. A request already accepted
by Proxmox may continue after a context switch: the UI reports it as unconfirmed,
and operators should inspect the original backend before retrying. These checks
do not prevent external changes to Proxmox or grant deployment ownership.

Validation covers selected/ambiguous/missing targets, registry changes, backend
and token switches, task polling, refused legacy setters, real config readback,
desired-tag preservation, failures and late responses. No live Proxmox writes
were used to validate this change.
