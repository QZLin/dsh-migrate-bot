import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { appRootFrom } from '../../src/paths.ts'

const root = appRootFrom(import.meta.url)
const entrypoint = resolve(root, 'container/entrypoint.sh')

/**
 * The entrypoint is bash with arrays. A bash that cannot run one cannot run it,
 * so the platform's own limitation is reported as a skip rather than a defect:
 * CI runs it on Linux, where every bash this Action supports has arrays.
 */
const bashRunsArrays = spawnSync('bash', ['-c', 'a=(1 2); test "${a[1]}" = 2'], { encoding: 'utf8' }).status === 0
const withoutArrays = bashRunsArrays ? false : 'this platform\'s bash has no arrays'

/** Run the entrypoint with a stand-in CLI and return the arguments it received. */
function argv(inputs: Record<string, string>, args: string[] = []): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-entry-'))
  try {
    const out = join(dir, 'argv.json')
    const cli = join(dir, 'cli.mjs')
    writeFileSync(cli, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.ARGV_OUT, JSON.stringify(process.argv.slice(2)))\n")
    const result = spawnSync('bash', [entrypoint, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: dir, GITHUB_WORKSPACE: dir, DSH_MIGRATE_CLI: cli, ARGV_OUT: out, ...inputs },
    })
    assert.equal(result.status, 0, result.stderr)
    return (JSON.parse(readFileSync(out, 'utf8')) as string[]).map(arg => arg.replace(dir, '<workspace>'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the inputs of a run become its arguments, and an empty input none', { skip: withoutArrays }, () => {
  assert.deepEqual(argv({ INPUT_WORKDIR: '.', INPUT_CONFIG: 'cfg.yml', INPUT_TARGET: '', INPUT_FORCE: 'true', INPUT_SKIP_GITHUB: 'false' }), [
    'bump', '--workdir', '<workspace>/.', '--config=cfg.yml', '--force',
  ])
})

test('the command input chooses the verb, and every input it has is mapped', { skip: withoutArrays }, () => {
  assert.equal(argv({ INPUT_COMMAND: 'check', INPUT_TARGET: '0.2.0' })[0], 'check')
  assert.deepEqual(argv({ INPUT_COMMAND: 'check', INPUT_TARGET: '0.2.0' }), ['check', '--workdir', '<workspace>/.', '--target=0.2.0'])
})

test('arguments given to docker run pass through unchanged', () => {
  assert.deepEqual(argv({ INPUT_COMMAND: 'bump' }, ['status']), ['status'])
})

test('every input the action declares is mapped by the entrypoint', () => {
  const action = parse(readFileSync(resolve(root, 'action.yml'), 'utf8')) as { inputs: Record<string, unknown> }
  const script = readFileSync(entrypoint, 'utf8')
  for (const input of Object.keys(action.inputs)) {
    assert.ok(script.includes(`INPUT_${input.toUpperCase()}`), `${input} is declared but not mapped`)
  }
})
