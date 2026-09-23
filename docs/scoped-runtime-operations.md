# Scoped runtime controls

Deployment details now expose administrator review for declared SDN network
creation/deletion, datacenter and selected-node firewall switches, and scoped
firewall rules and aliases. Controls require both the installed backend capability
and administrator permission. Existing guest firewall and NAT controls remain
available according to the user's permissions.

Open **Rules and observations** to see declared versus configured NAT, exact
zone/VNet/CIDR/gateway, pending changes, node activity, ordered scope rules,
aliases and per-NIC filtering prerequisites. Unreadable scopes remain unknown
without hiding readable scopes. **Read live NAT rules** records a durable native
observation; its timestamp and attempt ID identify historical evidence. Actual
guest traffic is never inferred from a configured switch or rule count.

Policy edits retain the complete visible source/destination restrictions. Only
owned supported non-management rules can be edited, deleted or reordered. New
rules are inserted first. Owned aliases can be renamed or deleted after backend
reference checks; node aliases are unavailable. Unsupported operations and
shared-scope authorization failures are displayed before execution. A refused
plan keeps the editor draft intact for correction and another review.

Before applying a scoped operation, review its target host/node, pinned revision,
network identity or policy change and acknowledge the shared scope. The backend
requires its current review fingerprint and refuses configuration drift.
Network creation never adopts an existing VNet; deletion requires its exact
backend ownership marker and no attached guests/templates. Shared zones remain.
Existing bootstrap networks without this marker cannot be deleted here. Network
lifecycle requires a single-node cluster until NAT preservation/readback can be
verified on every node affected by shared apply. Legacy
bridge conflicts are explicit migration blockers.

These are runtime requests, recorded with sanitized results by the existing Git
history controls. They do not change the saved scenario. A later deployment may
restore declared NAT/policy settings or recreate a deleted network. Partial or
unverified attempts retain readback/recovery guidance in deployment history.

The [backend contract](https://github.com/range42/range42-backend-api/blob/feat/sdn-scoped-operations-20260922/docs/scoped-runtime-operations.md)
describes the exact eight operation kinds, permissions and safety boundaries.
`e2e/runtime-scopes.spec.ts` checks review/refusal, preserved drafts, accessibility
and layout at 1280px and 390px with intercepted API responses. The
[shared acceptance record](shared-sdn-acceptance-20260923.md) covers the installed
paired applications, actual UI authoring/alias/Git actions and API-owned guest,
traffic, content and cleanup checks. Backend #74 tracks this qualification;
review, branch integration and release promotion remain separate.
