---
kind: operations
description: Setting the Action up in a plugin repository: the workflow, the permissions, and the configuration file.
---

# Installing the Action

## The workflow

1. Copy [examples/workflow.yml](../../examples/workflow.yml) to `.github/workflows/dsh-migrate.yml`, set the cron, and pin the release as [releasing](release.md#what-a-consumer-pins) describes. The file chooses the triggers and calls the reusable workflow [`.github/workflows/migrate.yml`](../../.github/workflows/migrate.yml) of this repository with `secrets: inherit`.

   No secret is needed: a migration consults no model, and the workflow's own token is enough. The reusable workflow maps `GITHUB_TOKEN` and nothing else.
2. Optionally copy [examples/dsh-migrate.yml](../../examples/dsh-migrate.yml) to `.github/dsh-migrate.yml`. Every key is optional and listed in the [configuration reference](../reference/configuration.md); an unknown or renamed key fails the run with a message that names the replacement.
3. In Settings → Actions → General → Workflow permissions, enable **Allow GitHub Actions to create and approve pull requests**. Without it the workflow token pushes the proposal branch and opens the issue, and then gets HTTP 403 when it opens the pull request.

The reusable workflow holds the concurrency group that keeps one writer of the state branch at a time, and runs one job, `bump`, on the schedule and on manual dispatch. The caller grants `contents: write` (the proposal branch and the state branch), `issues: write` and `pull-requests: write`. The reusable workflow takes three inputs — `target` and `force` for a manual run, and `config` for a configuration file at another path — and returns the Action's `status`, `target_tag`, `verified_tag` and `pull_request_url` as its outputs.

The Action runs the image `ghcr.io/qzlin/dsh-migrate-bot` of its release, built once per release, so every consumer run uses the same Node and the same system packages.

The first scheduled run bumps to the target release. When a later run skips a release, and what `force` changes, is in [starting a migration](../design/workflow.md#6-starting-a-migration).

## The proposal

The migration pushes one branch, `dsh-migrate/proposal`, and opens one issue and one pull request that carry the changed fields and the output of every check. A pull request whose checks failed is a **draft**: merge it once the failure is fixed, or close it and wait for the next release.

Do not add commits to the branch while the proposal is open: a newer release takes the proposal over with a force-push, and a proposal that carries commits a maintainer made is left alone until it is merged or closed.

## The state branch

The Action writes `dsh-migrate/state` in the consumer repository: one event log per migration and `badge.json`. Leave the branch unmerged; nothing reads it but the Action and the badge.

## A copy of the reusable workflow

A variable the reusable workflow does not map — a proxy, a registry mirror, a `DSH_MIGRATE_HOME` of your own — reaches the Action only through a copy of the reusable workflow in the plugin repository:

1. Copy `.github/workflows/migrate.yml` of the release you would pin to `.github/workflows/dsh-migrate-jobs.yml`, and set each variable in its top-level `env`. For the major tag, that is the release it points to now: the `vX.Y.Z` tag that `git ls-remote --tags https://github.com/QZLin/dsh-migrate-bot` lists with the major tag's commit, never a release candidate.
2. In the workflow of step 1 above, call `./.github/workflows/dsh-migrate-jobs.yml` instead, still with `secrets: inherit`. The copy runs the release its `uses:` line names, so leave the job as copied.
3. A major tag moving on no longer upgrades the Action: an upgrade is a new copy of the new release's `migrate.yml`, with the variables set again.
