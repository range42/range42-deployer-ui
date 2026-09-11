# Git provider acceptance — 2026-09-10

The actual UI publication orchestrator (`publishFilesToTargets`) and provider adapters were exercised against GitHub, an existing GitLab instance, and an isolated Gitea 1.24.7 instance. Test repositories contain a harmless two-file Ansible role fixture; no existing catalog repositories or user branches were modified.

| Check | GitHub | GitLab | Gitea |
|---|---|---|---|
| One saved snapshot → public review + private main | Passed | Passed | Passed |
| Atomic multi-file contribution commit | Passed | Passed | Passed |
| Repeat publication reuses exact open review and commit | Passed | Passed | Passed |
| Upstream synchronization preserves branch history | Passed | Passed, separate review | Passed |
| Changed published SHA blocks final merge | Passed | Passed | Passed |
| Current reviewed SHA merges | Passed | Passed | Passed |
| Conflicting update preserves both branch heads | Passed | Passed, unresolved review | Passed |
| Organization/group fork relationship and access verification | Unit coverage | Passed live | Passed live |
| Cross-project review reuse, fork update and merge | Unit coverage | Passed live | Passed live |

Detailed sanitized results contain commit SHAs, review URLs and repository identities: [GitHub](acceptance/github-20260910.json), [GitLab](acceptance/gitlab-20260910.json), [Gitea](acceptance/gitea-20260910.json).

## Findings resolved

- Republishing an existing contribution previously attempted a duplicate review. Providers now reuse only an open review matching the source repository/project, source branch and target branch. Another fork with the same branch name is rejected.
- GitLab cannot create a branch from a new upstream SHA that has not reached its fork object database. Synchronization now opens a reverse cross-project merge request from the upstream branch into the contribution branch, where the fork owner reviews and merges it. This neither resets a branch nor rebases it.
- A delayed private-clone credential update cannot attach the browser token to a changed source or backend. The repository dialog captures and rechecks its source identity before storing the publishing credential.

## Credential and transport boundaries

GitHub tests used the existing `pparage` account. GitLab tests used the existing `phparage` account with a personal token. Tokens were read internally by the acceptance process, not written to reports or command output. Gitea used a temporary local test administrator.

A separate GitLab project-token check confirmed that a token scoped to the fork can write that fork but cannot create a cross-project merge request against upstream (HTTP 403). The temporary token was revoked. Cross-project contributions need an appropriately authorized personal/group credential; this matches [GitLab's documented project-token scope](https://docs.gitlab.com/user/project/settings/project_access_tokens/). Provider permission failures remain visible.

GitLab's certificate names `gitlab-ph.srv.office.lhc.lu`; connecting to its configured `100.64.0.21` IP directly fails hostname verification. The acceptance process used the certificate hostname with an address mapping to that Tailscale IP, preserving HTTPS certificate verification. Browser/backend deployments need an equivalent working DNS/address configuration.

Gitea's contribution-update API has no expected-head compare-and-swap option. The adapter checks the reviewed head first and requests a normal merge, preserving history; GitHub additionally sends its expected-head parameter. GitLab synchronization remains an explicit separate review. Repository protections remain enforced by each provider.

## Test repositories and cleanup

- GitHub: `pparage/range42-acceptance-20260910-public-gh1` and `pparage/range42-acceptance-20260910-private-gh1`. The private repository is also used for the shared backend/PVE acceptance scenario on its separate `range42-ui/shared-smoke-20260910` branch; retain it while that project is registered.
- GitLab final run: `phparage/range42-acceptance-20260910-public-gl2`, `phparage/range42-acceptance-20260910-private-gl2`, and group `range42-acceptance-20260910-gl2` containing the verified fork. Earlier run `gl1` created the equivalent two personal projects and one group fork; those remain isolated diagnostic history.
- Deliberate conflict reviews were closed without merging. Successful contribution and synchronization reviews remain merged for inspection. Test branches remain available for audit; none was force-reset.
- Gitea ran in container `range42-gitea-acceptance-20260910`, exposed only at `127.0.0.1:3301`. Its two repositories and organization fork were disposable; sanitized evidence is retained above.

The remote test repositories/groups are intentionally retained for inspection and ongoing deployment acceptance. They can be deleted by their owners once linked backend projects and deployments no longer need their pinned revisions. The local Gitea container and anonymous volumes are removed after collecting evidence; its pulled image remains cached.
