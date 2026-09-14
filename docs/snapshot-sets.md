# Snapshot sets in Deployment Overview

Pinned concrete deployments expose a Snapshot sets panel beside Runtime controls. It uses the backend's reviewed QEMU snapshot-set API, rather than the legacy team snapshot endpoint. No new template, controller, playbook or SDN operation is introduced.

The panel loads saved metadata, prepares a separate review, displays every member's name/VMID/UUID and the target/revision/expiry, then requires an explicit confirmation. Rollback and deletion have their own plans. Rollback warns that guests remain stopped. Member results distinguish accepted, successful, failed, not started and unconfirmed outcomes; there is no all-VM atomicity claim or application-consistency claim.

Submitted reviews are cleared even when the HTTP result is unknown. The client refuses expired plans and changed backend credentials, selected backend identity, deployment, revision or host. Accepted response validation checks the original set, operation, review digest and target fingerprint. A malformed accepted response is unconfirmed, never retry-safe. Refresh performs a metadata GET. The operator's Reconcile button reads saved native task state through the backend; the UI does not poll mutation endpoints or automatically repeat writes.

Unknown dispatch without a saved native task ID is shown as requiring operator recovery. This version cannot adopt an arbitrary remote task; the backend retains the deployment lock. The UI cannot cancel or clear that ownership. Older snapshot history remains visible, with mutation controls disabled when its revision/host differs from the current deployment.

Retention review displays the backend's keep-count/keep-days policy and only its eligible completed sets. Every candidate requires an individual confirmation. After one operation starts, complete/reconcile it and request a fresh review for remaining candidates. Unused plans can be cancelled without touching guests. Automatic retention enforcement remains off; the Settings preferences control review selection only.

Validation uses local HTTP fixtures and production-browser checks at 1280 and 390 pixels, including accessibility, member review, exact digest-only execution, and explicit read-only reconciliation. These tests perform no shared Proxmox mutations and do not substitute for storage-specific live snapshot/rollback acceptance. Backend persistence and recovery limits are documented in `range42-backend-api/docs/snapshot-sets.md`.
