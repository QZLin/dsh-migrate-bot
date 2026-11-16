# The checks

A migration runs three checks against the target release: mechanical, boot, and web. All are keyless — none needs a token, a model or an account — and all install the target release from npm, once per release, into a cache under `DSH_MIGRATE_HOME`.

## The checks

**Mechanical** is the plugin's own contract with the release, in five steps:

1. the dependency contract: every `@deepseek-ai/dsh-*` package the manifest names is published at the target, and its range admits it by npm's rules, which compare a prerelease only within the same `major.minor.patch`;
2. the source contract: no tracked source imports a `@deepseek-ai/dsh-*` package the release no longer publishes — parsed with TypeScript, JSDoc and `import()` types included;
3. the plugin shape: the manifest declares `dsh.bundle`, and the patch file it names parses;
4. install and run: `npm install` when `node_modules` is missing, the dsh packages pinned to the release, then `build`, `typecheck` and `test` as the manifest declares them;
5. a report: the first failing line, normalised, plus the output.

`tests.commands` replaces steps 4 and 5 with the consumer's own commands, which run in each plugin's directory.

**Boot** installs the plugin into a temporary profile and starts dsh, and passes when dsh reaches the credential check. It is skipped when every plugin has a browser half (`dsh.client`) or declares an agent preset, which only the web composition can load.

**Web** serves a temporary web profile with the plugins mounted, waits for its ready line, and reads the agent-preset roster. It is skipped when the plugin declares neither a `dsh.client` surface nor a preset.

A check reports `pass`, `fail`, or `skipped` with the reason. The first failure ends the pass: a later check would mostly report the consequences of the earlier one.

## What a check may read

A check runs the plugin's own commands, on the runner, with the Action's environment minus every credential variable the Action holds (`withoutSecrets`). That is not a sandbox: the commands are the consumer's code and may do what their author wrote. It only keeps a token out of what a plugin's build prints into a log the Action then publishes.

## A check is not a repair

The Action never changes the plugin to make a check pass. What a failing check needs is a change to the plugin's own sources, and the decision belongs to whoever maintains it. The migration records the failure in a draft pull request and stops there.

This is the boundary that makes a migration predictable: the same plugin and the same release produce the same proposal, the plugin's code in the proposal is exactly the bump, and a maintainer reading a draft knows that everything else is theirs.

## Watchdogs

Every mechanical command has a wall-clock limit (`timeouts.commandMs`), and so does the boot check and the web check (`checks.boot.timeoutMs`, `checks.web.timeoutMs`). A command that hangs is killed and reported as a failure of its check, rather than holding the job until the runner's own six-hour limit.

## Design decisions

- **The checks are keyless and deterministic** (*decided*). Why: they answer whether the plugin works on the release, which is a property of the plugin and the release, not of a token or a model. Constraint: a check may install from npm and run the plugin's commands, and may not call a model. Revisit when: a check needs a credential the consumer must supply, which would make the answer depend on who runs it.
- **The first failure ends the pass** (*decided*). Why: the checks are ordered from cheapest and most specific to most expensive, and a later check after a failure reports the consequence rather than the cause. Constraint: a failing migration reports one check; the remaining ones say `skipped` by absence, not by a result.
