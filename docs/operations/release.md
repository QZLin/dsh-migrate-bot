---
kind: operations
description: How a release of the Action is cut and how consumers receive it.
---

# Releasing

The version is in [`.cz.toml`](../../.cz.toml). [Commitizen](https://commitizen-tools.github.io/commitizen/) bumps `VERSION`, `package.json`, the Action version the reusable workflow `.github/workflows/migrate.yml` runs and `CHANGELOG.md` from the Conventional Commits since the last tag. The repository uses the pnpm version pinned by `packageManager` in [package.json](../../package.json), with [pnpm-lock.yaml](../../pnpm-lock.yaml) for reproducible installs. That lockfile stores dependency resolutions, not the Action's version, so a version-only bump leaves it unchanged. A breaking change bumps the major version, from `0.x` too, so consumers on the previous major tag keep the release they pinned.

```sh
pipx install commitizen
pnpm run commit        # write a commit in the project's format
pnpm run bump          # bump the version and the changelog
git push origin HEAD
git push origin "v$(cat VERSION)"
```

The tag needs its own push: commitizen creates lightweight tags, which `git push --follow-tags` does not push. A pushed `vX.Y.Z` tag runs [the release workflow](../../.github/workflows/release.yml): it moves the major tag (`v3.1.0` moves `v3`) and opens a GitHub Release. Nothing else is published, because a composite Action is built from the tag it is pinned to; a consumer therefore always runs the sources of the tag its workflow names. To move a major tag back, run the release workflow by hand with the tag to point it at.

## What a consumer pins

A consumer's workflow calls `QZLin/dsh-migrate-bot/.github/workflows/migrate.yml@v3`: the major tag, which moves to every release of that major version, so a breaking change needs a new major version. The major tag exists from the first final release of its version; until then, and to try a release candidate, a consumer pins the candidate's exact tag (`@v3.0.0-rc.1`), which never moves. Releases before 1.0.0 have no reusable workflow.

The `v2` major tag still points at the last container release, so a consumer that cannot install Node on its runner can pin it; `v3` and later are composite Actions.

## A release candidate

A release candidate is tried on a few consumers before the major tag moves to it:

```sh
cz bump --changelog --prerelease rc --prerelease-offset 1   # 3.0.0-rc.1, then rc.2, …
git push origin HEAD
git push origin "v$(cat VERSION)"
```

A pushed `vX.Y.Z-rc.N` tag opens a GitHub prerelease and moves no major tag, so only a consumer that pins it runs it; the reusable workflow at that tag runs the Action of the same tag. The final release is bumped from the last candidate with `pnpm run bump`.

The `release` gate of `pnpm run gates` fails when `VERSION`, `package.json`, `.cz.toml`, the Action version in `migrate.yml` and the newest release in `CHANGELOG.md` do not all state the same version. It also checks that `packageManager` pins pnpm and the root lockfile importer matches the manifest's dependency specifiers.

The `workflows` gate parses every Actions workflow as YAML and validates each job's executable steps or reusable workflow; the `action` gate requires `action.yml` to be a valid composite Action whose outputs name real step ids. Duplicate mapping keys, steps without `uses` or `run`, a run step without a `shell`, and a `using: docker` manifest all fail before a push.

## Design decisions

- **The Action is a composite Action, not a container image** (*decided*). Why: a consumer needs no container runtime, and the Action is built from the tag its workflow pins, so the published code and the referenced code cannot drift apart. Constraint: `action.yml` declares `using: composite`; it installs Node and pnpm on the runner and builds the TypeScript from the tag's own sources; no image, `Dockerfile` or registry package is published. Revisit when: a consumer needs a prebuilt runtime the runner cannot assemble, such as an image pinned for a slow or offline network.

- **Release artifacts and consumer references belong to this fork** (*decided*). Why: the release workflow runs in `QZLin/dsh-migrate-bot`, so consumers must reference that repository rather than the upstream one. Constraint: every GitHub reference uses `QZLin/dsh-migrate-bot`, and version bumps keep the manifest and the reusable workflow in agreement. Revisit when: the publication owner changes.

- **pnpm is the repository package manager, pinned in the manifest** (*decided*). Why: one package manager and a frozen lockfile make local installs, CI and the Action's own build reproducible. Constraint: the Action is installed, built and tested with pnpm; the root npm lockfile is absent. Consumer checks retain npm's `--before` release cutoff and npm prerelease resolution rules, which the [checks design](../design/checks.md#the-checks) owns; changing the repository toolchain does not change those results. Revisit when: the consumer install policy itself changes.
