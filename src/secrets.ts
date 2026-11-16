import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The credential the Action holds: a GitHub token, from the environment or from
 * an untracked `.secrets.local.json`. A migration consults no model, so there is
 * no provider key to hold.
 */

export interface Secrets {
  githubToken?: string
}

function jsonString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Load secrets from the environment, then from `.secrets.local.json` if present.
 * The JSON file is never committed; see `.secrets.local.json.example`.
 * @param searchRoots - directories to look for `.secrets.local.json`
 */
export function loadSecrets(
  searchRoots: readonly string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Secrets {
  const env = options.env ?? process.env
  const merged: Secrets = {}
  if (env.GITHUB_TOKEN !== undefined && env.GITHUB_TOKEN !== '') merged.githubToken = env.GITHUB_TOKEN
  for (const root of searchRoots) {
    const file = resolve(root, '.secrets.local.json')
    if (!existsSync(file)) continue
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${file} must be a JSON object`)
    }
    const record = parsed as Record<string, unknown>
    if (merged.githubToken === undefined) {
      const token = jsonString(record, 'GITHUB_TOKEN')
      if (token !== undefined) merged.githubToken = token
    }
    break
  }
  return merged
}

/**
 * The environment of a check: the Action's own, without the token it holds.
 * The checks need no credential; this keeps one out of what they print and read
 * from their environment. It is not a sandbox (docs/design/checks.md).
 */
export function withoutSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !CREDENTIALS.has(name)))
}

/** Values of every credential variable, for final output redaction. */
export function secretValues(env: NodeJS.ProcessEnv): string[] {
  const values: string[] = []
  for (const name of CREDENTIALS) {
    const value = env[name]
    if (typeof value === 'string' && value.length >= 4 && !values.includes(value)) values.push(value)
  }
  return values
}

/** Every environment variable that may hold a credential this Action is given. */
const CREDENTIALS = new Set(['GITHUB_TOKEN', 'GH_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'])
