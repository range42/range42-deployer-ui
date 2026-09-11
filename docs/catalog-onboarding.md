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

## Use or customize an existing item

**Use** and **Customize** now ask for a working repository before creating a
project. A read-only original remains usable: choose a writable destination or
select the existing fork policy. Review the exact base commit, unused project
subdirectory and dedicated `range42-ui/…` branch, then create the local project.
Canceling or a failed review leaves existing local projects intact. The handoff
performs provider reads only; the editor's first Save creates the working branch
(and requests a fork when selected). Publishing and merging remain explicit,
separate operations. The original repository, source, path and commit remain
visible in the editor and survive ordinary saves, publication snapshots and
pinned Git reopening as public `meta.json.ui_catalog` provenance. Credentials
are excluded from that metadata.

The default catalog's **Ansible roles** open in **Config** with their complete
supported role files. The original `category.action.target` directory and file
bytes are preserved, including binary assets. The destination project directory
is an explicit prefix around those paths; it is never silently inferred to be
the original catalog directory. Existing target directories and working branches
are rejected during review. This imports role source for editing and publication;
it does not create a VM or validate a complete deployment environment. To attach that role to an existing VM scenario, use **Scenario → Add role** as
described below. Generic external dependency materialization remains unfinished.

A canonical `range42.yaml` lab/gamenet/component can instead import its editable
nodes, network links, inline attachments and variable declarations. Secret
variable declarations keep their names and flags but lose their default values.
Executable fields that cannot survive the current canvas serializer are rejected
with their field path. External attachment references are rejected rather than
dropped. Saved deployer projects should use **Open from Git**, which restores the
whole structured project from one pinned commit.

Current bounds are explicit: role trees have at most 512 entries; the existing
1 MiB per-file and 2 MiB complete-project limits apply before local creation.
Only regular `100644` role files are copied; executable modes, symlinks,
submodules, external role dependencies, unresolved task/variable/file references
and controller lookups require a full repository workflow. Alternate `action`/`local_action` syntax and implicit controller file lookups
are refused; literal `with_items` loops remain supported. This conservative
source check does not analyze arbitrary shell commands and is not an Ansible sandbox or a proof that a role's commands are
correct. Required packages, facts, collections and host services remain runtime
prerequisites. Container and bundle item customization is not implemented by
this handoff. Generic dependency materialization and distributed multi-tab edit
ownership remain separate unfinished work.

GitLab repository-tree reads now follow all pages at the same SHA (bounded to
10,000 entries). GitHub and Gitea return a clear error for truncated trees, so a
partial response cannot be mistaken for a complete role. File modes are retained
from provider metadata to distinguish regular files from symlinks and executable
files. These checks follow the provider tree contracts:
[GitHub](https://docs.github.com/en/rest/git/trees),
[GitLab](https://docs.gitlab.com/api/repositories/), and
[Gitea](https://docs.gitea.com/api/operations/get-tree/).

Source-level acceptance uses the actual seven-file
`02_ansible_layer/admin/roles/service.reload.ntp` tree at catalog commit
`0b170a768b9603cf8f5b080e4eac780cbad07c75`. Tests preserve its exact files and origin
through import, project/publication serialization and pinned reopening for the
three provider contracts. The focused suite passes 161 tests; scoped ESLint,
strict service TypeScript checks and the production build pass. Browser tests
against that production build at 1440 and 390 pixels exercise the real
catalog → destination review → Config → reload flow with intercepted read-only
provider requests. These are local acceptance tests, not provider publication or
shared deployment evidence, and do not endorse the role's runtime behavior.


## Execute an imported role on a scenario VM

After Catalog → Use/Customize, open the destination VM project and choose
**Scenario → Add role**. Select the imported local source and target VM, review
its current files, and stage the attachment. Set non-secret JSON variables and
use **Move up / Move down** to order it among files, scripts, playbooks and bundles.
Only **Review generated files → Use scenario files** applies the complete local
candidate. Save then checkpoints it through the existing Git binding; deployment
uses the saved pinned project revision. Canceling the picker or scenario leaves
the project unchanged.

The whole supported role tree is copied under its original
`category.action.target` path inside the destination project. Different bytes at
an existing path reject the copy; no role is fetched at execution time. One
version of a given role path can exist per project. Current-file review can
refresh an attachment after editing its copied files in Config; attachments still
using older hashes must also be reviewed. Removing an attachment retains the
copied files, so authored source is not silently deleted.

Each role becomes a separate configure play with the literal VM inventory name,
facts enabled, privilege escalation, backend workspace vault and reviewed role
parameters. Role parameters override role-defined vars through normal
[Ansible variable precedence](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html).
The role uses `{{ r42_project_dir }}/<project-relative-role-path>`;
`r42_project_dir` is supplied by the backend for the pinned project/subdirectory.
This [absolute role path](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbook_pathing.html)
avoids substituting a similarly named installed catalog role. Main YAML tasks,
handlers, defaults and vars are checked for explicit connection/managed-target
changes; controller lookups in templates are also rejected. This conservative
validation does not sandbox trusted Ansible plugins, templates or shell commands.
Guest packages, supported distributions, collections and service prerequisites
remain the operator's responsibility.

Ordinary saves, public/private publication snapshots and pinned Git reopening
retain `scenario.content[].role`: original public catalog identity plus SHA256
hashes of the **authored** role files. Original catalog SHA is not a claim that
edited files still equal upstream. Replication retains the source attachment and
emits one role play per literal target, preserving content order. Changed/missing
role files reject generation; conflicting Git authoring offers the existing
explicit files-only recovery instead of silently overwriting source.

`manifest/scenario_roles.json` is descriptive provenance, **not** a backend-sealed
bundle proof or an authorization boundary. The current backend trusts pinned
custom playbooks and ignores this optional manifest. Its non-replicated project
resolver validates the VM manifest schema but does not cross-check VM names
against inventory; replicated instance validation has stronger identity checks.
The missing non-replicated name cross-check is a known backend correctness bug
being handled separately; it is not the intended final contract. Backend
role-manifest sealing and arbitrary role dependency materialization also remain
unfinished.

`tools/verify-catalog-role-execution.mjs <backend-path>` provides a disposable,
local-only consumer check. The unchanged seven-file default
`service.reload.ntp@0b170a768b9603cf8f5b080e4eac780cbad07c75` passes real Ansible
syntax validation. A clearly separate safe authored replacement proves actual
local role lookup, target isolation, role-variable precedence and repeated
execution order, including an installed-name decoy. The NTP role's package and
service tasks are **not executed** or endorsed: its Fedora task uses shell `&&`
inside `command`, and its distribution/systemd prerequisites still apply.
This source acceptance creates no guest, provider commit or shared deployment.
