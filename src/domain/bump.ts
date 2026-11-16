import semver from 'semver'

/**
 * The version bump: what a plugin's `package.json` says after moving to a new
 * harness release, computed without touching the filesystem.
 *
 * A bump rewrites every `@deepseek-ai/dsh-*` range to admit the target release,
 * and, when the consumer asks for it, raises the plugin's own `version` by a
 * patch so the proposal reads as a release of the plugin. Dependencies outside
 * the harness scope and references that are not registry ranges (a workspace or
 * a `file:` path) are left alone.
 *
 * It performs no check of its own: a range pointed at a package the release no
 * longer publishes is written as it is, and the mechanical checks report it.
 */

/** The dependency blocks a bump rewrites, in the order they are reported. */
export const DEPENDENCY_BLOCKS = ['peerDependencies', 'dependencies', 'devDependencies', 'optionalDependencies'] as const

/** The scope of the harness packages, which every release publishes under its own version. */
export const DSH_SCOPE = '@deepseek-ai/dsh-'

export interface BumpChange {
  /** The manifest field: `version`, or `dependencies.@deepseek-ai/dsh-cli`. */
  field: string
  from: string
  to: string
}

export interface BumpPlan {
  /** The manifest to write; absent when nothing changes. */
  manifest: Record<string, unknown> | undefined
  changes: BumpChange[]
}

export interface BumpOptions {
  /** Raise the plugin's own `version` by a patch as well. */
  ownVersion: boolean
}

/** The range a plugin should name for a harness release. */
export function rangeFor(version: string): string {
  return `^${version}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Plan the bump of one plugin manifest.
 * @param manifest - the parsed `package.json`.
 * @param target - the target release's version, without the `dsh-v` prefix.
 * @param options - whether the plugin's own version moves too.
 */
export function planBump(manifest: Record<string, unknown>, target: string, options: BumpOptions): BumpPlan {
  const changes: BumpChange[] = []
  const next: Record<string, unknown> = { ...manifest }
  const desired = rangeFor(target)
  for (const block of DEPENDENCY_BLOCKS) {
    const entries = manifest[block]
    if (!isRecord(entries)) continue
    const bumped: Record<string, unknown> = { ...entries }
    let touched = false
    for (const [name, range] of Object.entries(entries)) {
      // A workspace, file or git reference is not a registry range.
      if (!name.startsWith(DSH_SCOPE) || typeof range !== 'string' || semver.validRange(range) === null) continue
      if (range === desired) continue
      bumped[name] = desired
      touched = true
      changes.push({ field: `${block}.${name}`, from: range, to: desired })
    }
    if (touched) next[block] = bumped
  }
  const own = manifest.version
  if (options.ownVersion && typeof own === 'string' && semver.valid(own) === own) {
    const to = semver.inc(own, 'patch')
    if (to !== null) {
      next.version = to
      changes.push({ field: 'version', from: own, to })
    }
  }
  return { manifest: changes.length === 0 ? undefined : next, changes }
}

/**
 * Format a manifest the way the file it came from was written, so a bump shows
 * as the lines it changed and nothing else.
 * @param original - the file's current text.
 * @param manifest - the manifest to write.
 */
export function formatManifest(original: string, manifest: Record<string, unknown>): string {
  const indent = /^\{\r?\n([ \t]+)"/.exec(original)?.[1] ?? '  '
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const body = JSON.stringify(manifest, null, indent)
  return original.endsWith('\n') || original === '' ? `${body}${newline}` : body
}
