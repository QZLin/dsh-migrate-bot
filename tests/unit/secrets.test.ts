import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSecrets, secretValues, withoutSecrets } from '../../src/secrets.ts'

test('reads the GitHub token from the environment', () => {
  assert.deepEqual(loadSecrets([], { env: { GITHUB_TOKEN: 'gh-token' } }), { githubToken: 'gh-token' })
  assert.deepEqual(loadSecrets([], { env: { GITHUB_TOKEN: '' } }), {})
})

test('reads the token from .secrets.local.json when the environment has none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mig-secrets-'))
  try {
    writeFileSync(join(dir, '.secrets.local.json'), JSON.stringify({ GITHUB_TOKEN: 'from-file' }))
    assert.deepEqual(loadSecrets([dir], { env: {} }), { githubToken: 'from-file' })
    // The environment wins over the file.
    assert.deepEqual(loadSecrets([dir], { env: { GITHUB_TOKEN: 'from-env' } }), { githubToken: 'from-env' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a secret file that is not a JSON object is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mig-secrets-'))
  try {
    writeFileSync(join(dir, '.secrets.local.json'), '[]')
    assert.throws(() => loadSecrets([dir], { env: {} }), /must be a JSON object/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the environment of a check holds no token the Action was given', () => {
  const env = {
    PATH: '/bin',
    GITHUB_TOKEN: 'gh-token',
    GH_TOKEN: 'gh-token',
    ACTIONS_RUNTIME_TOKEN: 'runtime',
  }
  assert.deepEqual(withoutSecrets(env), { PATH: '/bin' })
})

test('every credential value is collected for redaction, and short ones are not', () => {
  assert.deepEqual(secretValues({ GITHUB_TOKEN: 'gh-token', GH_TOKEN: 'abc' }), ['gh-token'])
})
