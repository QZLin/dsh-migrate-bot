import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { configSchema, type MigrateConfig } from './schema.ts'

export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

/**
 * Keys and values that 1.0 renamed or removed, with what replaced them.
 *
 * Strict validation already rejects them; this table only makes the error name
 * the replacement, so a configuration written for the model-driven Action is
 * told what happened to the keys that no longer do anything.
 */
const REPLACED: readonly { path: readonly string[]; value?: string; replacement: string }[] = [
  { path: ['dshVersion'], replacement: 'renamed to `target`' },
  { path: ['agent'], replacement: 'removed; a migration runs no model' },
  { path: ['prompts'], replacement: 'removed; a migration runs no model' },
  { path: ['quota'], replacement: 'removed; a migration spends nothing' },
  { path: ['secrets'], replacement: 'removed; a migration needs no API key' },
  { path: ['review'], replacement: 'removed; a migration runs no review' },
  { path: ['repair'], replacement: 'removed; a failing check is reported, never repaired' },
  { path: ['reports'], replacement: 'removed; a migration sends no merge report' },
  { path: ['checks', 'cards'], replacement: 'removed; the change-card ledger belonged to the model-driven review' },
  { path: ['checks', 'e2e'], replacement: 'removed; the end-to-end suite was authored by a model' },
  { path: ['timeouts', 'agentMs'], replacement: 'removed; a migration runs no model session' },
  { path: ['timeouts', 'checkoutMs'], replacement: 'removed; a migration checks out no harness source' },
  { path: ['deploy'], replacement: 'removed; a migration streams no run log and serves no preview' },
  { path: ['loop'], replacement: 'removed; a migration makes one attempt' },
  { path: ['watch'], replacement: 'removed; an unchanged target release is always skipped unless the run is forced' },
  { path: ['feedback'], replacement: 'removed; a migration sends no merge report' },
  { path: ['verify'], replacement: 'renamed to `checks` (`verify.boot` is `checks.boot`, `verify.web` is `checks.web`)' },
  { path: ['e2e'], replacement: 'removed; the end-to-end suite was authored by a model' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function valueAt(document: unknown, path: readonly string[]): unknown {
  let current = document
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

/** The first replaced key or value in a decoded document, as an error message. */
function replacedKey(document: unknown): string | undefined {
  for (const entry of REPLACED) {
    const found = valueAt(document, entry.path)
    if (found === undefined || (entry.value !== undefined && found !== entry.value)) continue
    const subject = entry.value === undefined ? entry.path.join('.') : `${entry.path.join('.')}: \`${entry.value}\``
    return `${subject} was ${entry.replacement}`
  }
  return undefined
}

/**
 * Validate a decoded YAML document and fill in the defaults.
 * @param raw - the decoded document; `null` or `undefined` is an empty file.
 */
export function parseConfig(raw: unknown): MigrateConfig {
  const document = raw ?? {}
  const replaced = replacedKey(document)
  if (replaced !== undefined) throw new ConfigError(replaced)
  const parsed = configSchema.safeParse(document)
  if (!parsed.success) throw new ConfigError(z.prettifyError(parsed.error))
  return parsed.data
}

/**
 * Load and validate a configuration file.
 * @param filePath - absolute or relative path.
 */
export function loadConfigFile(filePath: string): MigrateConfig {
  return parseConfig(parseYaml(readFileSync(filePath, 'utf8')))
}
