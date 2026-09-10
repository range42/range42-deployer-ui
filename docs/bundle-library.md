# Reusable VM bundle library

Scenario authoring can attach a catalog bundle to a selected VM after the backend verifies that its pinned source content matches the installed runtime. The library searches registered sources, displays bundle scope/tier tags, and provides a separate **Connect default SDN bundle library** action. That action registers and refreshes `range42/range42-playbooks` on `feat-sdn-implementation`; the default catalog remains a separate source.

Selecting a bundle loads its detail and full source SHA, then calls:

```http
POST /v1/catalog/sources/{source_id}/bundles/resolve
Content-Type: application/json

{"path":"bundles/<tier>/<bundle>","sha":"<full source commit>","target_kind":"VM"}
```

The response must identify the same source, path and revision, a VM-scoped entrypoint relative to `RANGE42_BUNDLE_DIR`, descriptor parameters, managed target variables, and a sealed runtime/dependency proof. A source mismatch, unsupported scope, missing revision or unavailable runtime prevents attachment. The detail panel lists the installed dependency revisions/hashes. This pins the backend environment; it does not claim equivalence to the source repository’s original dependencies. The backend rechecks runtime provenance during deployment preflight and launch. A displayed catalog entry alone does not authorize executing an identically named installed bundle.

Parameters are generated from the descriptor. String, integer, boolean, JSON-list and JSON-object inputs preserve the declared types and allowed values; `bool_style: yesno` emits `YES` or `NO` where required by existing bundles. Blank values with declared defaults or a declared default location inherit the bundle’s own defaults. Caller values cannot include template expressions. VM target variables and `from_vault` parameters have no editable fields and are excluded from caller values saved to Git. Required vault values must already be available through the backend workspace vault.

The library emits this scenario-content item:

```json
{
  "id": "<content id>",
  "kind": "bundle",
  "target_node": "<canvas VM node id>",
  "path": "<verified entrypoint relative to bundles/>",
  "vars": {"EXAMPLE_PORT": 8080},
  "resolution": {"source_id":"...","source_sha":"...","runtime":{"fingerprint":"...","proof":"..."}}
}
```

`resolution` contains the complete backend response, including descriptor parameters, target variable names and the proof kind. Scenario generation binds its managed target values from the selected VM and records the complete resolution in `manifest/scenario_bundles.json`, alongside the matching configure import.

This initial executable library supports VM scope. GROUP, XTIER, INFRA and UNKNOWN entries remain discoverable, but the backend rejects attaching them to a single VM. Arbitrary private bundle trees are not copied or substituted for installed dependencies; their source content must satisfy the same runtime verification. Runtime drift requires reselecting and verifying the bundle against the intended installed release before regenerating the scenario.
