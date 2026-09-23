# Editor preferences

Settings → Preferences stores three editor preferences in this browser under
`range42_editor_preferences`. A new app instance restores them. Invalid JSON,
wrong field types and invalid grid spacing fall back to defaults: automatic
Git saves enabled, snap-to-grid enabled, and a 20 px grid. Spacing is restricted
to integers from 10 through 50 px. If browser storage is unavailable, changes
remain usable for the current session and the preferences panel reports that
they could not be stored.

“Automatically save the Git working branch” controls the existing 1.5-second
Git checkpoint after an edit. It applies only to a project already connected
to Git. Turning it off prevents future automatic Git checkpoints, including a
pending checkpoint when leaving the editor. It does not undo a Git request
that has already started. Local project drafts continue to be saved in browser
storage, including pending graph edits on exit; turning the preference off does
not clear or revert edits. Normal browser storage limits still apply.

Re-enabling the preference schedules a checkpoint of the current draft through
the existing Git lock and compare-and-swap path. It cannot override another
editor's lock or silently replace a changed remote revision. Explicit Save,
scenario review/save and Save-and-Deploy keep their existing behavior regardless
of this preference. Publication to other targets and merging remain separate
explicit actions. See [Git editor locking](git-editor-locking.md) for recovery.

Snap-to-grid and grid spacing are bound directly to the editor's VueFlow
`snapToGrid`/`snapGrid` options; the same spacing controls the visible Background.
Preferences update the mounted editor without changing tab/file/node URL
parameters. Changing spacing does not rewrite existing node positions; snapping
applies when nodes are moved.

The focused tests cover saved-value validation, preference controls, persistence
failure feedback, actual ProjectEditor/VueFlow bindings, local preservation,
pending checkpoint and exit suppression, re-enabling, lock-loss refusal,
explicit Save-and-Deploy, and the existing deep-link tests. Component tests
replace the Git transport and shallow-render canvas internals; they do not
claim live provider writes or browser drag acceptance.
