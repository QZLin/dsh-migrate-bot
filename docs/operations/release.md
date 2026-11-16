---
kind: operations
description: How a release of the Action is cut and how consumers receive it.
---

# Releasing

The version is in [`.cz.toml`](../../.cz.toml). [Commitizen](https://commitizen-tools.github.io/commitizen/) bumps `VERSION`, `package.json`, the image tag in `action.yml`, the Action version the reusable workflow `.github/workflows/migrate.yml` runs and `CHANGELOG.md` from the Conventional Commits since the last tag. The repository uses the pnpm version pinned by `packageManager` in [package.json](../../package.json), with [pnpm-lock.yaml](../../pnpm-lock.yaml) for reproducible installs. That lockfile stores dependency resolutions, not the Action's version, so a version-only bump leaves it unchanged. A breaking change bumps the major version, from `0.x` too, so consumers on the previous major tag keep the release they pinned.

```sh
pipx install commitizen
pnpm run commit        # write a commit in the project's format
pnpm run bump          # bump the version and the changelog
git push origin HEAD
git push origin "v$(cat VERSION)"
```

The tag needs its own push: commitizen creates lightweight tags, which `git push --follow-tags` does not push. A pushed `vX.Y.Z` tag runs [the release workflow](../../.github/workflows/release.yml): it builds the image, which fails when the CLI cannot load, pushes it to `ghcr.io/qzlin/dsh-migrate-bot:vX.Y.Z`, then moves the major tag (`v1.2.0` moves `v1`) and opens a GitHub Release. The image is pushed before the major tag moves, so a consumer never resolves a tag whose image does not exist. The package must be public for consumers to pull it. To move a major tag back, run the release workflow by hand with the tag to point it at.

The publisher uses `docker/metadata-action` to lowercase the GHCR image name and label it with the source repository and revision. On first publication GitHub creates the package as private, even for a public repository; set it to **Public** in Package settings before consumers use the Action ([GitHub's visibility procedure](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility#configuring-visibility-of-packages-for-your-personal-account)). The release checks anonymous manifest access before moving the major tag or creating the GitHub Release. If that check stops the first publication, make the package public and rerun only the failed job; the image job does not need to publish again.

## What a consumer pins

A consumer's workflow calls `QZLin/dsh-migrate-bot/.github/workflows/migrate.yml@v2`: the major tag, which moves to every release of that major version, so a breaking change needs a new major version. The major tag exists from the first final release of its version; until then, and to try a release candidate, a consumer pins the candidate's exact tag (`@v2.0.0-rc.1`), which never moves. Releases before 1.0.0 have no reusable workflow.

## A release candidate

A release candidate is tried on a few consumers before the major tag moves to it:

```sh
cz bump --changelog --prerelease rc --prerelease-offset 1   # 2.0.0-rc.1, then rc.2, …
git push origin HEAD
git push origin "v$(cat VERSION)"
```

A pushed `vX.Y.Z-rc.N` tag builds and pushes the image and opens a GitHub prerelease, and moves no major tag, so only a consumer that pins it runs it; the reusable workflow at that tag runs the Action of the same tag. The final release is bumped from the last candidate with `pnpm run bump`.

The `release` gate of `pnpm run gates` fails when `VERSION`, `package.json`, `.cz.toml`, the image tag in `action.yml`, the Action version in `migrate.yml` and the newest release in `CHANGELOG.md` do not all state the same version. It also checks that `packageManager` pins pnpm and the root lockfile importer matches the manifest's dependency specifiers.

The `workflows` gate parses every Actions workflow as YAML and validates each job's executable steps or reusable workflow. Duplicate mapping keys and steps without `uses` or `run` fail before a push.

## Design decisions

- **Release artifacts belong to this fork** (*decided*). Why: the publishing workflow runs in `QZLin/dsh-migrate-bot`, so consumers must reference that repository and its GHCR package rather than the upstream repository. Constraint: GitHub references use `QZLin/dsh-migrate-bot`; OCI image names use lowercase `qzlin/dsh-migrate-bot`; version bumps keep both references in agreement. Revisit when: the publication owner changes.

- **pnpm is the repository package manager, pinned in the manifest** (*decided*). Why: one package manager and a frozen lockfile make local installs, CI and image builds reproducible. Constraint: the Action is installed, built and tested with pnpm; the root npm lockfile is absent. Consumer checks retain npm's `--before` release cutoff and npm prerelease resolution rules, which the [checks design](../design/checks.md#the-checks) owns; changing the repository toolchain does not change those results. Revisit when: the consumer install policy itself changes.
