import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nonLatinLetters } from '../../scripts/verify-english.ts'
import { wrappedLines } from '../../scripts/verify-md-wrap.ts'
import { checkModule, runtimeImports } from '../../scripts/verify-pure-core.ts'
import { ACTION_REPOSITORY, readReleaseFiles, verifyRelease } from '../../scripts/verify-release.ts'
import { glossaryTerms, verifyTerms } from '../../scripts/verify-terms.ts'
import { verifyAction, verifyActionSource, verifyWorkflowSource, verifyWorkflows } from '../../scripts/verify-workflows.ts'

const ACTION_YML = readReleaseFiles().actionYml

const GLOSSARY = [
  '| Term | Definition | In code | Replaces |',
  '|---|---|---|---|',
  '| **proposal** | The branch, issue and pull request. | `Proposal` | migrate PR, migration pull request |',
  '| **deploy service** | The HTTP service. | `deploy.endpoint` | deploy target |',
].join('\n')

test('verify-terms reads each term and the words it replaces from the glossary table', () => {
  assert.deepEqual(glossaryTerms(GLOSSARY).map(entry => [entry.term, entry.replaces]), [['proposal', ['migrate PR', 'migration pull request']], ['deploy service', ['deploy target']]])
})

test('verify-terms rejects a replaced word in prose and accepts it in code', () => {
  const documents = new Map([
    ['docs/a.md', '# A\n\nOpen the Migrate PR on the deploy target.\n\n`deploy-target.ts` is a file name.\n\n```\nmigrate PR in a sample\n```\n'],
    ['action.yml', 'description: talks to the deploy target\n'],
  ])
  assert.deepEqual(verifyTerms(documents, GLOSSARY).map(v => `${v.file}:${String(v.line)} ${v.detail}`), [
    'docs/a.md:3 "migrate PR" is "proposal" in the glossary',
    'docs/a.md:3 "deploy target" is "deploy service" in the glossary',
    'action.yml:1 "deploy target" is "deploy service" in the glossary',
  ])
  assert.deepEqual(verifyTerms(new Map([['docs/b.md', 'The deploy targets list.\n']]), GLOSSARY), [])
})

test('verify-terms rejects a term defined twice', () => {
  const twice = `${GLOSSARY}\n| **Proposal** | Again. | — | — |`
  assert.deepEqual(verifyTerms(new Map(), twice).map(v => v.detail), ['**Proposal** is defined again (first on line 3)'])
})

test('verify-english rejects letters of other scripts and accepts symbols', () => {
  // The letters under test are escaped, or this file would fail the gate it tests.
  const chinese = '\u4e2d\u6587'
  const delta = '\u0394'
  assert.deepEqual(nonLatinLetters('a.ts', `const a = "naïve → ≥ — ×"\n// ${chinese}\nconst ${delta} = 1\n`).map(v => `${String(v.line)} ${v.detail}`), [`2 non-English letters ${chinese}`, `3 non-English letters ${delta}`])
})

test('verify-md-wrap rejects a hard-wrapped paragraph and accepts lists, tables and fences', () => {
  const source = ['---', 'kind: design', 'description: x', '---', '', '# Title', '', 'One line.', 'Wrapped line.', '', '- item', '  continued', '- item', '', '| a |', '| b |', '', '```', 'code', 'code', '```'].join('\n')
  assert.deepEqual(wrappedLines('d.md', source), [{ file: 'd.md', line: 9 }])
})

test('verify-release requires every version statement to agree with VERSION', () => {
  const files = readReleaseFiles()
  assert.deepEqual(verifyRelease(files), [])
  const version = files.version.trim()
  const other = version === '0.0.1' ? '9.9.9' : '0.0.1'
  const drifted = verifyRelease({ ...files, packageJson: JSON.stringify({ ...JSON.parse(files.packageJson), version: other }) })
  assert.deepEqual(drifted, [`package.json says ${other}, VERSION says ${version}`])
  const workflow = verifyRelease({ ...files, migrateYml: files.migrateYml.replace(`uses: ${ACTION_REPOSITORY}@v${version}`, `uses: ${ACTION_REPOSITORY}@v1`) })
  assert.deepEqual(workflow, [`migrate.yml uses #1 says 1, VERSION says ${version}`])
  const missing = verifyRelease({ ...files, migrateYml: files.migrateYml.replace(`uses: ${ACTION_REPOSITORY}@v${version}`, '') })
  assert.deepEqual(missing, [`migrate.yml says nothing, VERSION says ${version}`])
})

test('verify-action requires a composite Action whose outputs name real step ids', () => {
  assert.deepEqual(verifyAction(), [])
  const docker = 'name: x\ndescription: y\nruns:\n  using: docker\n  image: docker://ghcr.io/owner/name:v1\n'
  assert.ok(verifyActionSource(docker).some(problem => problem.detail.includes('using')))
  const badOutput = ACTION_YML.replace('value: ${{ steps.run.outputs.status }}', 'value: ${{ steps.missing.outputs.status }}')
  assert.deepEqual(verifyActionSource(badOutput), [{ file: 'action.yml', detail: 'output status names step missing, which is not a step id' }])
  // A composite Action has no default shell, so a run step without one is invalid.
  const noShell = 'name: x\ndescription: y\nruns:\n  using: composite\n  steps:\n    - run: echo hi\n'
  assert.ok(verifyActionSource(noShell).some(problem => problem.detail.includes('shell')))
})

test('verify-release rejects upstream references and states the Action repository once', () => {
  assert.equal(ACTION_REPOSITORY, 'QZLin/dsh-migrate-bot')
  const files = readReleaseFiles()
  const version = files.version.trim()
  const upstream = files.migrateYml.replace(`uses: ${ACTION_REPOSITORY}@`, 'uses: royenheart/dsh-migrate-bot@')
  assert.deepEqual(verifyRelease({ ...files, migrateYml: upstream }), [`migrate.yml says nothing, VERSION says ${version}`])
})

test('verify-release rejects an unpinned package manager and a stale pnpm importer', () => {
  const files = readReleaseFiles()
  const unpinned = { ...JSON.parse(files.packageJson), packageManager: 'pnpm@latest' }
  assert.deepEqual(verifyRelease({ ...files, packageJson: JSON.stringify(unpinned) }), ['package.json packageManager must pin an exact pnpm version'])
  const stale = files.pnpmLock.replace('specifier: ^7.8.5', 'specifier: ^0.0.1')
  assert.deepEqual(verifyRelease({ ...files, pnpmLock: stale }), ['pnpm-lock.yaml dependencies.semver says ^0.0.1, package.json says ^7.8.5'])
  assert.deepEqual(verifyRelease({ ...files, pnpmLock: 'importers: {}\n' }), ['pnpm-lock.yaml must contain a valid root importer'])
})

test('verify-workflows accepts the repository workflows and reusable jobs', () => {
  assert.deepEqual(verifyWorkflows(), [])
  assert.deepEqual(verifyWorkflowSource('on: push\njobs:\n  build:\n    steps:\n      - run: echo ok\n  reuse:\n    uses: owner/repo/.github/workflows/test.yml@v2\n', 'valid.yml'), [])
})

test('verify-workflows rejects duplicate YAML keys', () => {
  const source = 'on: push\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n        with: {fetch-depth: 1}\n        with: {fetch-depth: 0}\n'
  assert.ok(verifyWorkflowSource(source, 'duplicate.yml').some(problem => problem.detail.includes('Map keys must be unique')))
})

test('verify-workflows rejects missing or conflicting execution steps', () => {
  assert.ok(verifyWorkflowSource('on: push\njobs:\n  build:\n    steps:\n      - with: {context: .}\n', 'missing.yml').length > 0)
  assert.ok(verifyWorkflowSource('on: push\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n        run: echo wrong\n', 'both.yml').length > 0)
  assert.ok(verifyWorkflowSource('on: push\njobs: {}\n', 'empty.yml').length > 0)
})

test('verify-pure-core reads run-time imports and rejects one with side effects', () => {
  assert.deepEqual(runtimeImports("import type { A } from '../git/run.ts'\nimport { z } from 'zod'\nexport { b } from './b.ts'\nimport { readFileSync } from 'node:fs'\n"), ['zod', './b.ts', 'node:fs'])
  assert.deepEqual(checkModule('src/workflow/x.ts', "import { readFileSync } from 'node:fs'\nimport { git } from '../git/run.ts'\nimport { compareReleases } from '../domain/release.ts'\nimport { configSchema } from '../config/schema.ts'\n").map(v => v.detail), [
    'imports the package node:fs',
    'imports src/git/run.ts, which is not part of the pure core',
  ])
})
