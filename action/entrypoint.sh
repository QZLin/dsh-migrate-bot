#!/usr/bin/env bash
# The composite Action's entrypoint: turn the Action inputs, which the caller
# passes as INPUT_* variables, into the CLI's arguments. Arguments given to the
# script are passed through unchanged, so a person can run it by hand.
set -euo pipefail

app_root="${DSH_MIGRATE_APP_ROOT:-${GITHUB_ACTION_PATH:-}}"
if [[ -z "$app_root" ]]; then
  echo 'GITHUB_ACTION_PATH is not set, so the Action cannot locate its own checkout' >&2
  exit 1
fi
workspace="${GITHUB_WORKSPACE:-$PWD}"
# The consumer checkout is owned by the runner's user, which git does not always
# trust; the Action only reads and commits inside it.
git config --global --add safe.directory '*'
export DSH_MIGRATE_HOME="${DSH_MIGRATE_HOME:-$workspace/.dsh-migrate}"
cli="${DSH_MIGRATE_CLI:-$app_root/dist/src/cli.js}"

if [[ $# -gt 0 ]]; then
  exec node "$cli" "$@"
fi

workdir="${INPUT_WORKDIR:-.}"
[[ "$workdir" = /* ]] || workdir="$workspace/$workdir"
args=("${INPUT_COMMAND:-bump}" --workdir "$workdir")
# `--name=value`: a value that starts with `-` stays a value.
option() { if [[ -n "${2:-}" ]]; then args+=("$1=$2"); fi; }
flag() { if [[ "${2:-false}" == [Tt]rue ]]; then args+=("$1"); fi; }
option --config "${INPUT_CONFIG:-}"
option --target "${INPUT_TARGET:-}"
flag --force "${INPUT_FORCE:-}"
flag --skip-github "${INPUT_SKIP_GITHUB:-}"
exec node "$cli" "${args[@]}"
