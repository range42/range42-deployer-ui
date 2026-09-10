# Connect a catalog repository

1. In **Settings → Backend API hosts**, add and select your backend URL. Its
   optional bearer token authenticates to the API gateway, not to GitHub.
2. Open **Git Sources** and connect the recommended **Range42 public catalog**.
   This uses `https://github.com/range42/range42-catalog`, branch `main`, without
   a Git token. The backend registers the repository and indexes its content.
3. Wait for indexing to finish, then open **Catalog**. An indexing failure stays
   visible so you can correct connectivity or credentials and retry.

For your own repository, use **Add source**, enter the full HTTP or HTTPS repository
URL and its branch, and select the provider. Register one repository per source
so catalog entry paths identify a single repository. Private repositories can use an optional
personal access token. Git credentials entered here are sent to the selected
backend for catalog access; the source API returns only whether a token exists.
Project editing and publishing use the separate browser Git-provider connection.

Sources belong to the selected backend. Reloading the page reads registrations
from that backend; changing backends loads that backend's sources. Removing a
source removes its registration from the backend. It does not delete the Git
repository. Existing browser-only source records must be registered through this
flow before they can be indexed by the backend.

## Repository formats

The default catalog uses the existing layered repository layout. The backend
recognizes `range42.yaml`, container `meta.json`, and Ansible role `meta/main.yml`
entries. You do not need to convert it into the older inventory system's
`components/vms/*.json` layout. The legacy inventory panel and project publishing
remain separate features.

## Create an Ansible role

Open **Catalog → New Ansible role** to create a reusable catalog item. Enter its
category, action and target, such as `software.install.example_service`, followed
by its description, tags, tasks and optional default variables. Tasks must be a
nonempty YAML task list; the scenario that calls the role selects its hosts.

**Preview files** shows the complete files before publication. The generated
directory follows the public catalog convention:

```text
02_ansible_layer/admin/roles/software.install.example_service/
  tasks/main.yml
  meta/main.yml
  defaults/main.yml
  README.md
```

Choose **Choose publication targets**, then select the working repository and
each destination explicitly. The publisher first checkpoints the reviewed files
on a dedicated `range42-ui/…` branch. Each destination can receive a pull request
or a direct publication when the connected Git account has permission. Existing
role directories are treated as naming collisions rather than overwritten.
Publication results and retries are tracked separately for each destination;
closing the publisher returns to the preserved role form.

After direct publication, refresh the Git source registered for that destination
branch, then reopen the catalog. For a pull request to the public catalog, wait
for it to merge before refreshing its registered `main` branch. The backend
discovers the new role from `meta/main.yml` and displays its description and tags.
Repositories and branches must be registered with the backend before their items
appear in its catalog.

This form creates Ansible roles. Container and playbook-bundle authoring are not
implemented by this form.

## Deployment readiness

Catalog indexing makes reusable content available. Deploying still requires a
configured target, credentials and Ansible dependencies. For a registered project
with a pinned commit, the backend loads the concrete scenario, inventory and assets
from that commit. Its preflight checks scenario files and manifest VMIDs. Unpinned
installed scenarios use the backend's configured playbook directory and report
`SCENARIO_PLAYBOOK_UNAVAILABLE` when their entrypoint is missing.

SDN is the target default for new setups and authored scenarios. Its provisioning
is still being integrated across the controller, playbooks, backend and UI.
Existing bridges remain an explicit compatibility option; an SDN scenario must
report missing capabilities instead of silently switching to that option.
Catalog onboarding does not provision networks. See the backend's
[integration readiness notes](https://github.com/range42/range42-backend-api/blob/dev/docs/integration-readiness.md)
for the current playbook and SDN boundaries.

## API contract

Catalog requests use the selected backend URL and its gateway bearer token.
With no configured URL, relative `/v1/` requests can use a same-origin development
proxy. Production installations should configure the backend explicitly.

- `GET /v1/catalog/sources` returns a paginated `{items, total, offset, limit}`.
- `POST /v1/catalog/sources/default` reuses or registers the public catalog.
- `POST /v1/catalog/sources` accepts provider, host `base_url`, `auth_kind`, optional
  `token_ref`, and `repos: [{owner, repo, branch}]`.
- `POST /v1/catalog/sources/{id}/refresh` reports repositories visited and entries
  indexed; a source with no repositories is an error.
- `PATCH /v1/catalog/sources/{id}` changes Git credentials; `auth_kind: "none"`
  clears the stored token.
- `DELETE /v1/catalog/sources/{id}` removes the registration.

Source responses include repository bindings and their last successful refresh
timestamps. The setup checklist completes the catalog step after a repository
has been indexed on the selected backend. Cached catalog entries are scoped to
the backend URL, and an offline fallback continues to show the request error.
