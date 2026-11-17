---
kind: reference
description: Every key of .github/dsh-migrate.yml with its type, default and meaning.
---

# Configuration reference

A consumer configures the Action in `.github/dsh-migrate.yml`. Every key is optional, and an unknown key is an error. This page is generated from `src/config/schema.ts` by `scripts/references.ts`; edit the source, not this page.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `target` | string | `latest` | The dsh release to bump the plugins to: `latest`, a version such as `0.2.0-rc.2`, or a `dsh-v*` tag. |
| `bump.ownVersion` | boolean | `true` | Raise each plugin's own `version` by a patch during the dependency update. |
| `tests.commands` | list of string | — | Shell commands that replace the built-in mechanical checks; they run in each plugin's directory. |
| `checks.boot.enabled` | boolean | `true` | Run the boot check. |
| `checks.boot.timeoutMs` | integer | `180000` | Watchdog for one boot check, in milliseconds. |
| `checks.web.enabled` | boolean | `true` | Run the web check. |
| `checks.web.timeoutMs` | integer | `120000` | Watchdog for one web check, in milliseconds. |
| `timeouts.commandMs` | integer | `1200000` | Watchdog for one mechanical command. |
