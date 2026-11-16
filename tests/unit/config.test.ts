import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { loadConfigFile, parseConfig } from '../../src/config/load.ts'
import { appRootFrom } from '../../src/paths.ts'

test('an empty file yields the defaults', () => {
  for (const raw of [undefined, null, {}]) {
    const config = parseConfig(raw)
    assert.equal(config.target, 'latest')
    assert.equal(config.bump.ownVersion, true)
    assert.equal(config.checks.boot.enabled, true)
    assert.equal(config.checks.boot.timeoutMs, 180_000)
    assert.equal(config.checks.web.timeoutMs, 120_000)
    assert.equal(config.timeouts.commandMs, 1_200_000)
  }
})

test('an unknown key is rejected rather than ignored', () => {
  assert.throws(() => parseConfig({ targte: 'latest' }), /targte/)
  assert.throws(() => parseConfig({ bump: { ownVerison: true } }), /ownVerison/)
})

test('a key of the model-driven Action names what happened to it', () => {
  assert.throws(() => parseConfig({ dshVersion: 'latest' }), /dshVersion was renamed to `target`/)
  assert.throws(() => parseConfig({ agent: { model: 'x' } }), /agent was removed; a migration runs no model/)
  assert.throws(() => parseConfig({ prompts: { repair: 'x' } }), /prompts was removed/)
  assert.throws(() => parseConfig({ secrets: { apiKeyEnv: 'X' } }), /secrets was removed/)
  assert.throws(() => parseConfig({ review: { policy: 'always' } }), /review was removed/)
  assert.throws(() => parseConfig({ repair: { maxAttempts: 2 } }), /repair was removed/)
  assert.throws(() => parseConfig({ reports: { enabled: true } }), /reports was removed/)
  assert.throws(() => parseConfig({ checks: { cards: { enabled: true } } }), /checks\.cards was removed/)
  assert.throws(() => parseConfig({ checks: { e2e: { enabled: true } } }), /checks\.e2e was removed/)
  assert.throws(() => parseConfig({ timeouts: { agentMs: 1000 } }), /timeouts\.agentMs was removed/)
  assert.throws(() => parseConfig({ deploy: { endpoint: 'https://deploy.test' } }), /deploy was removed/)
})

test('values are validated with the key path in the message', () => {
  assert.throws(() => parseConfig({ tests: { commands: [] } }), /tests\.commands/)
  assert.throws(() => parseConfig({ checks: { boot: { timeoutMs: 10 } } }), /checks\.boot\.timeoutMs/)
})

test('a partial section keeps the defaults of its other keys', () => {
  const config = parseConfig({ bump: { ownVersion: false }, checks: { web: { enabled: false } } })
  assert.equal(config.bump.ownVersion, false)
  assert.equal(config.checks.web.enabled, false)
  assert.equal(config.checks.boot.enabled, true)
})


test('the shipped example configuration validates', () => {
  const config = loadConfigFile(join(appRootFrom(import.meta.url), 'examples', 'dsh-migrate.yml'))
  assert.equal(config.target, 'latest')
})
