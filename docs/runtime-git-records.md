# Runtime changes in Git

Deployment details records new VM/scenario firewall and outgoing NAT operations on the connected project's dedicated working branch. The request is saved after the backend accepts the operation; its result is saved when the attempt reaches a terminal state. An accepted request already saved by this browser resumes result recording after reload. Older operations have an explicit **Save to Git** action.

Each record lives at `scenarios/<label>/runtime/<deployment>/<attempt>/request.json` or `result.json`. It includes the backend URL, deployment/attempt identifiers, pinned project SHA, target host, explicit requested state and available outcome flags. Partial, failed and cancelled outcomes retain their meaning. Logs, credentials, runtime proofs and arbitrary error details are excluded; full diagnostics remain in backend attempt history.

Saving requires the exact local project registration for the selected backend, repository and scenario. The current working branch must exist and differ from the base branch. The provider appends the record and merges `meta.json`'s authored-file index in one commit guarded by the branch HEAD. Concurrent remote updates fail for review/retry; the operation never rewrites the canvas or silently forks into another repository. A conflicting existing record is preserved.

Pending records are retained in the local project before Git IO. Git failure is shown separately from the live operation and can be retried without repeating the operation. Successful records join the project's ordinary files and therefore its explicit public-review/private-publication workflow. Merely viewing historical attempts does not publish them. The Git save can finish if the operator navigates away; it cannot select credentials or a repository from a newly chosen backend.

## Limits

- Git recording runs in the connected browser. Closing the browser immediately after submitting an operation may leave it recorded only in backend history until **Save to Git** is used. Backend-driven offline publication is not implemented.
- A branch commit is a record of intent and observed outcome. It does not alter the generated deployment policy. Update the authored scenario for settings that should be applied by future deployment/configure runs; authored Proxmox firewall policy remains separate work.
- A missing local project registration, unavailable Git credentials, malformed file index, changed branch or exhausted browser storage prevents a Git save and is reported. The backend operation can still succeed independently.
- Runtime records share the authored-file size and browser-storage limits. Pending records are persisted with the transactional project store before any remote commit; a quota rejection is visible without a partial Git write.
- The displayed commit is the recorded revision, not a claim that another writer has never subsequently changed the branch.

Focused tests cover exact binding, independent request/result records, partial outcomes, omitted secret-bearing metadata, atomic file-index merging, branch races, idempotence, local conflicts, quota failure, explicit historical saving, reload and backend/repository switches. Real provider and browser acceptance are recorded with release evidence.

Real isolated branches on GitHub, GitLab and disposable Gitea verified request/result files, exact readback at the returned commit, idempotent retry, preserved remote metadata and excluded private runtime fields. GitHub result revision: `4a8024c8a331808f6d751891d80221f16c98c57d`; GitLab: `57ec58d6b99a8ca50738ea5b3ccbd2a966274c6d`; Gitea: `e2fb0ca0d41080898d135d88195013f4e1e05aca` (test container and volumes subsequently removed). These were workstation provider tests, not a backend GitLab connectivity claim. Desktop1440px and mobile390px browser tests verified visible Git failures with no false saved status, page errors, overflow or axe violations in the runtime-record panel.
