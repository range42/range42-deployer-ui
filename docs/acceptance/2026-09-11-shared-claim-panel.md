# Shared deployment allocation panel acceptance — 2026-09-11

The shared HTTP UI passed real allocation reservation handoff, claim display, active-operation blocking, refusal and explicit release checks. This accepts allocation controls; the three-guest full deployment did **not** pass.

## Matched installed release

| Component | Verified revision / digest |
| --- | --- |
| UI | `472cdb4c9f3db51af85d488d9e061dfc33e0e705` |
| API | `411a878d8478fb5eeeb0334b6edae66a3cbcdd8f` |
| Catalog | `0a9448d4f7daf8e9ba27e5c916237ffbe6ccf6f9` |
| Deployment recipe | `ffa11a977613523efc1b24fcefb77b759b841d18` |
| Runtime fingerprint | `8f40a7a151d026879d6b563b5416c58377836ed4bb4d0aa8faad176f49e41020` |
| Served UI index SHA256 | `58ca5b7606c4613ff213e4a7f0fce91350d27ef56267ebe8bdb1bbc3ff615b3a` |

The installed retry release was verified before browser mutations. The scenario used exact Git revision `e3e589161a9d513dc5cc2bc5b9721e8002c956b4` on the existing isolated acceptance branch `range42-ui/allocation-replication-20260911-e59720`. Its core VM/network manifests contain no catalog or bundle execution proofs.

Deployment `419b9e9979ef4eaf` (`ALLOC_DIAG_1`) used VM IDs `60000–60002`: addresses `10.42.70.20`, `10.42.70.21` on `r42smk`, and `10.42.71.20` on `r42smk2`. The local authoring identity differed from the registered backend project identity throughout the handoff.

## Browser results

| Phase | Passed assertions | Actual result |
| --- | ---: | --- |
| Create | 4 | ProjectEditor reserved all literal instances, applied/reviewed the mapping, saved the unchanged pinned snapshot and submitted `POST /v1/deployments/`: **201**. Claim GET: **200**; consumed draft lease: **409 ALLOCATION_EXPIRED**. |
| Observe | 2 | Reopened the same deployment and displayed its exact revision and every VM/NIC assignment; local project and private owner state remained unchanged. |
| Busy | 3 | During real full attempt `505eb94ae7e14839`, the release button was disabled with an explanation; no release request was sent. |
| Refusal | 3 | After that attempt terminated with guests still present, one explicit Review → Confirm called `DELETE /v1/deployments/419b9e9979ef4eaf/allocations`: **409 ALLOCATION_IN_USE**. The panel displayed the backend explanation and retained the unchanged claim (**200**); history remained accessible (**200**). |
| Release | 3 | After teardown, one explicit Review → Confirm called the same DELETE: **204**. The panel refreshed and confirmed **404 ALLOCATION_NOT_FOUND**; deployment/history remained **200** and local project/owner state was preserved. |

The reservation owner was sent only in its private header during deployment creation. Release requests used normal backend authentication with **no body and no reservation-owner header**. No provider, attempt, guest or SDN mutations were forwarded by the panel phases; no browser page errors occurred.

The Git adapter normally discovers an existing branch by attempting ref creation. The harness independently verified the existing acceptance ref at the exact SHA, then returned GitHub-shaped **422 Reference already exists** for only that exact request. It forwarded no provider mutation. All other provider writes were blocked; the acceptance pin and repository main remained unchanged.

## Guest lifecycle and limits

The coordinator's full attempt `505eb94ae7e14839` failed with exit code 2 during the second guest's cloud-init wait. VM `60000` passed that stage, `60000` and `60001` remained running, and `60002` was not created. This was the real condition used to test release refusal.

Owned teardown attempt `90e433c1974c42c4` succeeded with exit code 0. Before authorizing UI release, the coordinator verified all three test VM IDs absent, all 47 original guests unchanged and NAT unchanged. The final independent post-release audit was still pending when this report was written.

Two harness readiness checks were corrected without changing product state: persistent deployment event streams require DOM/content readiness instead of network-idle, and claim/attempt requests finish independently, so release review waits for the actual enabled button. The harness never forced UI state or bypassed backend guards.

Sanitized local evidence: `acceptance-summary.json`, five phase reports, screenshots and `checksums.json` under `/tmp/r42-shared-claim-panel-browser`. Summary SHA256: `636b00e1f5d3787e7ffd41edc35e7613cc155019c07119560611a0c4e19687b2`. Credentials, private browser state and raw event streams are excluded from this report.
