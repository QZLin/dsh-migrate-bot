import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planBump, formatManifest, rangeFor } from '../../src/domain/bump.ts'

const MANIFEST = {
  name: '@acme/plugin',
  version: '1.4.2',
  peerDependencies: { '@deepseek-ai/dsh-cli': '^0.1.7', react: '^18' },
  dependencies: { '@deepseek-ai/dsh-llm': '>=0.1.0 <0.2', '@deepseek-ai/dsh-local': 'workspace:*' },
  devDependencies: { '@deepseek-ai/dsh-agent': '~0.1.7', typescript: '^5' },
}

test('every dsh range is raised to the target, and nothing outside the scope moves', () => {
  const plan = planBump(MANIFEST, '0.2.0', { ownVersion: false })
  assert.deepEqual(plan.changes.map(change => `${change.field}: ${change.from} -> ${change.to}`), [
    `peerDependencies.@deepseek-ai/dsh-cli: ^0.1.7 -> ${rangeFor('0.2.0')}`,
    `dependencies.@deepseek-ai/dsh-llm: >=0.1.0 <0.2 -> ${rangeFor('0.2.0')}`,
    `devDependencies.@deepseek-ai/dsh-agent: ~0.1.7 -> ${rangeFor('0.2.0')}`,
  ])
  assert.deepEqual(plan.manifest?.peerDependencies, { '@deepseek-ai/dsh-cli': '^0.2.0', react: '^18' })
  // A workspace reference is not a registry range and is left alone.
  assert.deepEqual(plan.manifest?.dependencies, { '@deepseek-ai/dsh-llm': '^0.2.0', '@deepseek-ai/dsh-local': 'workspace:*' })
  assert.equal(plan.manifest?.version, '1.4.2')
})

test('the plugin\'s own version rises by a patch when the consumer asks for it', () => {
  const plan = planBump(MANIFEST, '0.2.0', { ownVersion: true })
  assert.equal(plan.manifest?.version, '1.4.3')
  assert.deepEqual(plan.changes.at(-1), { field: 'version', from: '1.4.2', to: '1.4.3' })
})

test('a manifest that already names the target changes nothing', () => {
  const already = { version: '1.0.0', dependencies: { '@deepseek-ai/dsh-cli': '^0.2.0' } }
  const plan = planBump(already, '0.2.0', { ownVersion: false })
  assert.deepEqual(plan.changes, [])
  assert.equal(plan.manifest, undefined)
})

test('a version that is not a release is left as it is', () => {
  const plan = planBump({ version: 'next', dependencies: { '@deepseek-ai/dsh-cli': '^0.1.7' } }, '0.2.0', { ownVersion: true })
  assert.equal(plan.manifest?.version, 'next')
  assert.deepEqual(plan.changes.map(change => change.field), ['dependencies.@deepseek-ai/dsh-cli'])
})

test('a manifest keeps the indentation and the trailing newline of its file', () => {
  const text = '{\n    "name": "@acme/plugin",\n    "version": "1.0.0"\n}\n'
  const written = formatManifest(text, { name: '@acme/plugin', version: '1.0.1' })
  assert.equal(written, '{\n    "name": "@acme/plugin",\n    "version": "1.0.1"\n}\n')
  // A file without a trailing newline keeps that too.
  assert.equal(formatManifest('{"a":1}', { a: 2 }), '{\n  "a": 2\n}')
})
