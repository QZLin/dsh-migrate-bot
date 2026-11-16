import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { appRootFrom } from '../../src/paths.ts'
import { logPath, serializeLog, StateStore } from '../../src/state/store.ts'
import { checkout } from '../support/repository.ts'
import { input, logOf, proposedEvents } from '../support/migration.ts'

const CLI = join(appRootFrom(import.meta.url), 'dist', 'src', 'cli.js')

function cli(args: string[], cwd: string, env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string; output: string } {
  const output = join(cwd, '.github-output')
  writeFileSync(output, '')
  const result = spawnSync(process.execPath, [CLI, ...args, '--workdir', cwd], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GITHUB_OUTPUT: output, DSH_MIGRATE_HOME: join(cwd, '.dsh-migrate'), ...env },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: readFileSync(output, 'utf8') }
}

const CONFIG = 'checks:\n  boot:\n    enabled: false\n  web:\n    enabled: false\ntests:\n  commands:\n    - "true"\n'

function plugin() {
  const repo = checkout({
    'package.json': JSON.stringify({ name: '@acme/plugin', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    'cordis.patch.yml': '[]\n',
  })
  mkdirSync(join(repo.work, '.github'))
  writeFileSync(join(repo.work, '.github', 'dsh-migrate.yml'), CONFIG)
  mkdirSync(join(repo.work, 'node_modules'))
  return repo
}

test('an unknown command prints the usage and exits 2', () => {
  const repo = plugin()
  try {
    const result = cli(['migrate-everything'], repo.work)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /^usage: dsh-migrate <command>/)
  } finally {
    repo.cleanup()
  }
})

test('print-config shows the validated configuration, and a model-driven one is refused with the reason', () => {
  const repo = plugin()
  try {
    const shown = cli(['print-config'], repo.work)
    assert.equal(shown.status, 0)
    assert.equal(JSON.parse(shown.stdout).checks.boot.enabled, false)
    writeFileSync(join(repo.work, '.github', 'dsh-migrate.yml'), 'agent:\n  model: deepseek-v4-flash\n')
    const refused = cli(['print-config'], repo.work)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /agent was removed; a migration runs no model/)
  } finally {
    repo.cleanup()
  }
})

test('the default Action config path is optional, but a missing custom config is refused', () => {
  const repo = checkout()
  try {
    const defaults = cli(['print-config', '--config', '.github/dsh-migrate.yml'], repo.work)
    assert.equal(defaults.status, 0, defaults.stderr)
    assert.equal(JSON.parse(defaults.stdout).target, 'latest')
    assert.equal(JSON.parse(defaults.stdout).bump.ownVersion, true)
    const custom = cli(['print-config', '--config', 'missing.yml'], repo.work)
    assert.equal(custom.status, 1)
    assert.match(custom.stderr, /ENOENT/)
  } finally {
    repo.cleanup()
  }
})

test('check runs every enabled check against the named release', () => {
  const repo = plugin()
  try {
    const result = cli(['check', '--target', '0.2.0'], repo.work)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /mechanical: pass/)
    assert.match(result.output, /status=compatible/)
    assert.match(result.output, /target_tag=dsh-v0\.2\.0/)
  } finally {
    repo.cleanup()
  }
})

test('status prints the state the branch holds', () => {
  const repo = plugin()
  try {
    new StateStore(repo.work).write(undefined, new Map([[logPath('0.2.0'), serializeLog(logOf(input('0.2.0'), proposedEvents()))]]), 'seed')
    const result = cli(['status'], repo.work)
    assert.equal(result.status, 0)
    const status = JSON.parse(result.stdout) as { open?: { id: string } }
    assert.equal(status.open?.id, '0.2.0')
  } finally {
    repo.cleanup()
  }
})

test('a bump stops with the reason when the repository root holds no plugin', () => {
  const repo = checkout({ 'README.md': '# plugins live in subdirectories\n' })
  try {
    const result = cli(['bump'], repo.work)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /the repository holds no plugin/)
    assert.match(result.output, /status/)
    assert.match(result.output, /error/)
  } finally {
    repo.cleanup()
  }
})
