import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseConfig } from '../../src/config/load.ts'
import { runMechanical } from '../../src/mechanical/run.ts'

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mig-timeout-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

test('the command watchdog has a default and is overridable', () => {
  assert.equal(parseConfig({}).timeouts.commandMs, 1_200_000)
  assert.equal(parseConfig({ timeouts: { commandMs: 4000 } }).timeouts.commandMs, 4000)
})

test('nonsense watchdog values are rejected rather than silently ignored', () => {
  assert.throws(() => parseConfig({ timeouts: { commandMs: 10 } }), /timeouts\.commandMs/)
  assert.throws(() => parseConfig({ timeouts: { commandMs: 'soon' } }), /timeouts\.commandMs/)
  assert.throws(() => parseConfig({ timeouts: [] }), /expected object[\s\S]*at timeouts/)
})

test('a hung mechanical command is killed by the watchdog and reported as a failure', () => {
  const dir = fixture({ 'package.json': JSON.stringify({ name: 'p', scripts: {} }) })
  try {
    const started = Date.now()
    const result = runMechanical(dir, parseConfig({ tests: { commands: ['sleep 30'] } }), { timeoutMs: 1_500 })
    const elapsed = Date.now() - started
    assert.equal(result.ok, false)
    // The watchdog fires well before the sleep would end on its own.
    assert.ok(elapsed < 20_000, `took ${String(elapsed)}ms`)
    assert.match(result.log, /timed out after 2s \(watchdog\)/)
  } finally {
    // A killed command can hold its working directory for a moment on Windows.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('a command that finishes inside its watchdog passes', () => {
  const dir = fixture({ 'package.json': JSON.stringify({ name: 'p', scripts: {} }) })
  try {
    const result = runMechanical(dir, parseConfig({ tests: { commands: ['node -e "process.exit(0)"'] } }), { timeoutMs: 20_000 })
    assert.equal(result.ok, true, result.errors)
    assert.equal(result.checks, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
