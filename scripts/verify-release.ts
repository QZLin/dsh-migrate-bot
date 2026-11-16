/**
 * Gate: every file that states the release version states the same one.
 *
 * Commitizen bumps `VERSION`, `package.json` and `.cz.toml` together and writes
 * the changelog section; the reusable workflow runs the Action of that version.
 * The composite Action carries no version of its own because a consumer pins the
 * tag, so no manifest outside `package.json` states one. The pnpm lockfile
 * stores dependency resolutions rather than the version, so its root importer is
 * checked against the manifest's dependency specifiers instead.
 */

import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { readText, REPO_ROOT } from './repo.ts'

export const ACTION_REPOSITORY = 'QZLin/dsh-migrate-bot'

export interface ReleaseFiles {
  version: string
  packageJson: string
  pnpmLock: string
  czToml: string
  actionYml: string
  migrateYml: string
  changelog: string
}

export function readReleaseFiles(): ReleaseFiles {
  const read = (name: string): string => readText(join(REPO_ROOT, name))
  return { version: read('VERSION'), packageJson: read('package.json'), pnpmLock: read('pnpm-lock.yaml'), czToml: read('.cz.toml'), actionYml: read('action.yml'), migrateYml: read('.github/workflows/migrate.yml'), changelog: read('CHANGELOG.md') }
}

/** The Action version each job of the reusable workflow runs; one unnamed entry when no job names it, which never matches. */
function migrateUses(migrateYml: string): Array<[string, string | undefined]> {
  const uses = migrateYml.split('\n').filter(line => line.includes(`uses: ${ACTION_REPOSITORY}@`))
  return uses.length === 0
    ? [['migrate.yml', undefined]]
    : uses.map((line, index): [string, string | undefined] => [`migrate.yml uses #${String(index + 1)}`, line.split('@v')[1]?.trim()])
}

const manifestSchema = z.object({
  version: z.string(),
  packageManager: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  optionalDependencies: z.record(z.string(), z.string()).default({}),
})

const lockedDependencies = z.record(z.string(), z.object({ specifier: z.string() })).default({})
const lockSchema = z.object({
  importers: z.object({
    '.': z.object({
      dependencies: lockedDependencies,
      devDependencies: lockedDependencies,
      optionalDependencies: lockedDependencies,
    }),
  }),
})

/** Version statements and root dependency specifiers that differ from their source. */
export function verifyRelease(files: ReleaseFiles): string[] {
  const version = files.version.trim()
  const manifest = manifestSchema.parse(JSON.parse(files.packageJson))
  const stated: Array<[string, string | undefined]> = [
    ['package.json', manifest.version],
    ['.cz.toml', files.czToml.split('\n').find(line => line.startsWith('version = '))?.split('"')[1]],
    ...migrateUses(files.migrateYml),
    ['CHANGELOG.md newest release', files.changelog.split('\n').find(line => line.startsWith('## v'))?.slice(4).split(' ')[0]],
  ]
  const problems = stated.flatMap(([where, value]) => value === version ? [] : [`${where} says ${value ?? 'nothing'}, VERSION says ${version}`])
  if (manifest.packageManager === undefined || !/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager)) {
    problems.push('package.json packageManager must pin an exact pnpm version')
  }
  try {
    const lock = lockSchema.parse(parseYaml(files.pnpmLock)).importers['.']
    for (const block of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      const names = new Set([...Object.keys(manifest[block]), ...Object.keys(lock[block])])
      for (const name of [...names].sort()) {
        const declared = manifest[block][name]
        const locked = lock[block][name]?.specifier
        if (locked !== declared) {
          problems.push(`pnpm-lock.yaml ${block}.${name} says ${locked ?? 'nothing'}, package.json says ${declared ?? 'nothing'}`)
        }
      }
    }
  } catch {
    problems.push('pnpm-lock.yaml must contain a valid root importer')
  }
  return problems
}
