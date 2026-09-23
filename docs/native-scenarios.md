# Deploy a ready-made scenario

1. Connect the public `range42-playbooks` repository or your private Git source in Settings. A private source needs a credential with repository access.
2. Open a scenario from Catalog and choose Create project. For a repository not yet indexed, use Open from Git, select native scenario mode, and enter the relative scenario folder, for example `scenarios/demo_lab` or `training/exercise-a`.
3. Fork the public repository when you need your own copy, or open a writable branch in an existing repository. A fork retains the whole repository and shared dependencies.
4. Edit files in Config. The file tree includes shared bundles and other repository files, loaded on demand. Save commits your changes and the project's native scenario selection. You can reopen it later or open another scenario from the same fork.
5. Choose Deploy, then an available Range42 environment. Select the scenario's feature flags and any non-secret advanced parameters. Credentials come from the environment's vault. The selected environment fixes the target host.
6. Create the deployment, review its preflight, and run it. Logs and cancellation appear with the attempt. Its maintenance menu lists only actions actually supplied by the scenario, such as VM deployment, reset or network cleanup. Destructive actions require its deployment codename.

The deployment uses the complete saved Git commit, including files too large to edit in the browser. The editor's 2 MiB draft limit and bounded initial loading do not truncate the repository. Binary assets and additional files remain in Git. Context credentials and secret links are excluded from file editing.

All actions for an existing deployment use its original commit and feature selections. Save edits and create a deployment from the new revision to apply a changed native scenario. Native topology and replication come from its files; the canvas generator and its attachment controls are hidden.

If no environment is listed, the operator must connect this backend to existing contexts on the deployer-cli. The UI does not guess a disposable target or initialize a new infrastructure context. See the backend's `docs/native-scenarios.md` for setup and the acceptance matrix.

Preflight can block protected VM IDs. The current public `blank_scenario_4_subnets` and `kunai_lab` defaults contain protected IDs; change these consistently in your fork. A diagnostic scenario with zero declared VMs can still alter existing VM NICs and SDN resources. Use its own documented disposable targets and parameters.
