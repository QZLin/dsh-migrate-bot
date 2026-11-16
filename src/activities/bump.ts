import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatManifest, planBump } from '../domain/bump.ts'
import { findPlugins } from '../plugins.ts'
import { inline } from '../render/text.ts'
import type { MigrationInput } from '../workflow/model.ts'
import type { BumpChangeEntry } from '../workflow/model.ts'

/**
 * The bump activity: raise every plugin of the repository to the target release.
 *
 * It reads each `package.json` the plugin scan finds, computes the new manifest
 * in memory, and writes it back formatted as it was. Nothing is committed here;
 * the proposal activity stages whatever the tree holds.
 */

export interface BumpInput {
  workdir: string
  target: MigrationInput['target']
  ownVersion: boolean
}

export interface BumpResult {
  changes: BumpChangeEntry[]
  detail: string
}

export function bumpTree(input: BumpInput): BumpResult {
  const plugins = findPlugins(input.workdir)
  const changes: BumpChangeEntry[] = []
  for (const plugin of plugins) {
    const file = plugin.dir === '' ? 'package.json' : `${plugin.dir}/package.json`
    const path = join(input.workdir, file)
    const original = readFileSync(path, 'utf8')
    const plan = planBump(plugin.manifest, input.target.version, { ownVersion: input.ownVersion })
    if (plan.manifest === undefined) continue
    writeFileSync(path, formatManifest(original, plan.manifest))
    for (const change of plan.changes) changes.push({ plugin: plugin.name, file, ...change })
  }
  const detail = changes.length === 0
    ? `every plugin already names ${input.target.tag}`
    : `bumped ${String(changes.length)} field(s) across ${String(new Set(changes.map(change => change.file)).size)} manifest(s) to ${input.target.tag}`
  return { changes, detail: inline(detail, 300) }
}
