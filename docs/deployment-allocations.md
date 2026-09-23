# Deployment allocation controls

The deployment overview reads `GET /v1/deployments/{id}/allocations` through the selected authenticated backend. It displays the saved project revision, host/node, reservation time, VM IDs/names and every recorded NIC index, bridge and address. These are durable assignment records, not a live guest inventory. They do not expire when a draft lease expires or an attempt finishes.

Release requires an explicit review and confirmation. The UI sends `DELETE` to the same endpoint without a request body or draft reservation token. The backend remains responsible for checking target/revision identity, active or unknown attempts, workspace/provisioning locks and independent VM absence. A 409 refusal keeps the complete visible claim and displays the backend's reason. A 204 is followed by a fresh read; only 404 with `ALLOCATION_NOT_FOUND` confirms absence. An unsupported endpoint, missing deployment, denied access or failed read remains an error.

Known active operations and uncertain deployment status disable release and invalidate an open review. Backend/token/deployment changes clear the old claim and review; late responses cannot affect the new context. The server still decides whether a release is safe if operations start elsewhere or state changes during the request.

No claim is released automatically, including on navigation, successful teardown, cancellation or retry. Release does not delete guests, networks, deployment history or project files. This UI adds no direct Proxmox requests and does not read or expose the browser's private draft-allocation owner token.

Initial source validation: 17 focused behavior regressions cover claim 200, specific404 absence, unrelated404/401 errors, invalid identity, explicit409 retention,204/fresh404, live-operation gating and stale-context/duplicate-submit handling. The affected deployment-detail/runtime suite totaled 50 passing tests at that checkpoint.

Subsequent [shared claim-panel acceptance](acceptance/2026-09-11-shared-claim-panel.md) exercised the installed UI's durable claim read, refusal while guests existed, and explicit release after teardown. The current assessed UI `7c0aeda` / API `553af0a` pair includes these controls. That historical success concerns claim lifecycle and cleanup; the full three-guest provisioning attempt still failed during cloud-init. See the [screen/action evidence matrix](ui-backend-capability-matrix.md).
