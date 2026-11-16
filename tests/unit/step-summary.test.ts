import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderStepSummary, statusOf, writeStepSummary } from '../../src/github/summary.ts'
import { bumpEvent, draftEvents, failedEvent, input, proposal, proposedEvents, viewOf } from '../support/migration.ts'

test('a proposed migration names its status, what the bump did and the proposal', () => {
  const view = viewOf(input(), proposedEvents(proposal(9)))
  assert.equal(statusOf(view.state), 'proposed')
  const summary = renderStepSummary({ view, pluginName: '@acme/plugin' })
  assert.match(summary, /^## dsh-migrate: proposed/)
  assert.match(summary, /1 field\(s\) bumped/)
  assert.match(summary, /Proposal: https:\/\/github\.com\/acme\/plugin\/pull\/9/)
})

test('a draft proposal is named as one, with the failing check', () => {
  const view = viewOf(input(), draftEvents())
  const summary = renderStepSummary({ view, pluginName: '@acme/plugin' })
  assert.match(summary, /Draft proposal: /)
  assert.match(summary, /Failing check: mechanical \(mechanical: TS2304\)/)
})

test('a migration that ends failed names the failing check', () => {
  const view = viewOf(input(), [bumpEvent([]), failedEvent(), { type: 'tree.inspected', changed: false, files: 0 }])
  const summary = renderStepSummary({ view, pluginName: 'p' })
  assert.match(summary, /dsh-migrate: failed/)
  assert.match(summary, /Failing check: mechanical/)
})

test('a value from outside cannot forge a line of the summary', () => {
  const view = viewOf(input(), proposedEvents())
  const summary = renderStepSummary({ view, pluginName: 'x\n::add-mask::y' })
  assert.equal(summary.split('\n').some(line => line.startsWith('::')), false)
  assert.doesNotMatch(summary, /javascript:/)
})

test('the summary is appended to the step summary file, and nothing happens without one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-summary-'))
  try {
    const file = join(dir, 'summary.md')
    writeStepSummary('one\n', { GITHUB_STEP_SUMMARY: file })
    writeStepSummary('two\n', { GITHUB_STEP_SUMMARY: file })
    assert.equal(readFileSync(file, 'utf8'), 'one\ntwo\n')
    writeStepSummary('three\n', {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
