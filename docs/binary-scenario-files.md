# Binary scenario files

The scenario **Add file** flow accepts uploaded files alongside authored text. Uploads retain their original bytes. Review and the Config tab show binary metadata, download and replacement controls; binary content never enters the YAML or text editor. The Config tab stacks its panels on narrow screens.

A file attachment compiles to an ordinary `ansible.builtin.copy` task whose `src` points to the file checked out from Git. Base64 is an internal browser/JSON representation, not the file deployed to the guest. Scripts and playbooks still require text. Destination paths and modes retain the existing scenario validation.

## Storage and Git contract

`project.files[path]` remains a string for existing text files. Binary files use this tagged value:

```json
{"encoding":"base64","content":"AAECAw==","size":4,"media_type":"application/octet-stream"}
```

`size` is the decoded byte count. Base64 must be canonical, and imported sizes/types are validated. The MIME type is display metadata; download responses use `application/octet-stream`. File maps must be plain mappings with safe relative paths. Root `meta.json`, `overlay.json`, `canvas_layout.json`, `topology.json` and `.lock` are reserved for project persistence. Generic component publication may still use its own root filenames.

Git stores the decoded binary blob. `meta.json` records authored paths in `ui_files` and binary descriptors in `ui_binary_files`; descriptors contain encoding, size and optional MIME type, without duplicating the base64 payload. Reloading restores binary descriptors even for uploads whose bytes happen to be valid UTF-8 text. UTF-8 BOMs are preserved.

`GitProviderV1.getFileContent` supports lossless text/binary reads. The existing `getFile` text API remains available and rejects binary content instead of replacing invalid UTF-8 bytes. GitHub creates base64 blobs and references their SHAs in the atomic tree; GitLab and Gitea send base64 file payloads in their batch commit APIs. Filename segments are encoded in contents URLs so `#`, `?`, `%`, spaces and Unicode cannot change the selected path or branch. Provider errors carry numeric HTTP status, distinguishing missing files from denied access. See [GitHub blobs](https://docs.github.com/en/rest/git/blobs), [GitLab commits](https://docs.gitlab.com/api/commits/) and [Gitea API](https://docs.gitea.com/api/).

Loading resolves one working-branch commit, or the base branch only if the working branch does not exist. Every document and asset is read at that same commit. Missing files are reported; they are never recovered from a different branch. `ProjectState.revision = {branch, commit_sha}` identifies that read snapshot and is not serialized into Git metadata.

Publication copies a fixed snapshot before asynchronous work and compares file bytes when retrying. Public review and private direct publication therefore receive the same bytes. The entire composed project snapshot is validated before creating any fork or working branch.

## Current limits

The initial UI limits are **1 MiB per file** and **2 MiB total project files**, including generated files when saving the complete snapshot. Browser project storage is still synchronous local storage, shared with other saved projects. Its quota can be exhausted below those limits. Import, file replacement and scenario application check persistence before changing project data or starting a Git checkpoint; failure leaves the prior saved file intact and gives an actionable error.

These are initial limits, not complete support for large asset libraries. Larger binary files and durable capacity beyond the browser quota remain unfinished work. Git LFS is not implemented. This change does not create a backend asset store or automatically execute uploaded content. Existing structured scenario metadata reopening remains a separate integration task; the authored file map itself round-trips through Git.

## Validation — 2026-09-10

Tests cover every byte value, JSON persistence, forged metadata and traversal, limits before repository mutations, reserved project filenames, UTF-8/BOM reads, all three providers, immutable dual publication, Git manifest reload and concurrent branch advancement. Compiler tests verify a normal copy source path and rejection of binary scripts/playbooks.

Actual GitHub, GitLab and Gitea acceptance published a 1,024-byte fixture and UTF-8/BOM text to public review and private main, read both back byte-for-byte, and verified unchanged republishing reused the review and commit. All providers returned the same binary SHA-256: `785b0751fc2c53dc14a4ce3d800e69ef9ce1009eb327ccf458afe09c242c26c9`.

Sanitized evidence: [GitHub](acceptance/binary-github-20260910.json), [GitLab](acceptance/binary-gitlab-20260910.json), [Gitea](acceptance/binary-gitea-20260910.json). Only isolated acceptance repositories were used. Existing shared PVE scenario branches were unchanged; no PVE deployment was performed for this slice.

Production-browser checks cover upload, save/reload, exact downloaded bytes, quota rejection preserving the previous file, 1,440px/390px layouts and the new asset field's accessibility. The broad existing Config-side-panel accessibility findings are outside this slice; the asset field itself has no axe violations.

GitHub and GitLab test reviews remain available for inspection in the retained acceptance repositories. Fixture files live under `acceptance/binary-assets-20260910/`; their public base branches were unchanged, and private main only gained those isolated fixture paths. The disposable Gitea container and its anonymous volumes were removed after binary and runtime-record acceptance completed. Tokens are not included in reports.

Final isolated validation: **1,060 tests across 124 files passed**, production build passed, ESLint reported no errors or warnings, and the modified TypeScript service graph passed a strict temporary configuration. The repository has no project-wide TypeScript check configuration; this does not claim one.
