import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROPOSAL_MARKER, renderProposal } from '../../src/github/templates.ts'
import { bumpEvent, change, failedEvent, input, passedEvent, contextOf } from '../support/migration.ts'
import type { MigrationEvent } from '../../src/workflow/model.ts'

const passing: MigrationEvent[] = [bumpEvent([change('version', '1.0.0', '1.0.1')]), passedEvent()]
const failing: MigrationEvent[] = [bumpEvent(), failedEvent()]

function render(events: MigrationEvent[] = passing, draft = false, pluginName = '@acme/plugin') {
  return renderProposal({
    context: contextOf(input('0.2.0', { source: { release: { tag: 'dsh-v0.1.7', version: '0.1.7' }, origin: 'verified' } }), events),
    pluginName,
    checks: draft
      ? [{ check: 'mechanical', outcome: 'fail', fingerprint: 'mechanical: TS2304', detail: 'error TS2304: cannot find name `x`' }]
      : [{ check: 'mechanical', outcome: 'pass', fingerprint: '', detail: '' }],
    diff: 'diff --git a/package.json b/package.json\n- "version": "1.0.0"\n+ "version": "1.0.1"',
    draft,
    runUrl: 'https://github.com/acme/plugin/actions/runs/1',
  })
}

test('the proposal names the release range, the bump and every check', () => {
  const docs = render()
  assert.match(docs.title, /^Bump @acme\/plugin to DeepSeek Harness 0\.2\.0$/)
  assert.match(docs.issue, /Source release: `dsh-v0\.1\.7` \(verified\)/)
  assert.match(docs.issue, /Bump: 1 field\(s\) bumped/)
  assert.match(docs.issue, /Mechanical checks: pass/)
  assert.match(docs.issue, /`package\.json` version: `1\.0\.0` → `1\.0\.1`/)
  assert.match(docs.pullRequest, /The checks pass on `dsh-v0\.2\.0`/)
  assert.match(docs.pullRequest, /actions\/runs\/1/)
  assert.match(docs.pullRequest, /Merge with a merge commit/)
})

test('a draft proposal carries the failing output and says it is not ready', () => {
  const docs = render(failing, true)
  assert.match(docs.issue, /this pull request is a draft/)
  assert.match(docs.issue, /Mechanical checks: fail \(mechanical: TS2304\)/)
  assert.match(docs.issue, /## Failures/)
  assert.match(docs.pullRequest, /cannot find name/)
  assert.match(docs.pullRequest, /this pull request is a draft/)
})

test('the issue carries each section under its own heading', () => {
  const docs = render()
  const outline = docs.issue.split('\n').filter(line => /^#{1,2} /.test(line))
  assert.deepEqual(outline, [
    '# Bump of @acme/plugin to dsh-v0.2.0',
    '## Summary',
    '## Changes',
    '## Checks',
    '## Working tree',
  ])
})

test('both bodies carry the marker that finds them again', () => {
  const docs = render()
  assert.ok(docs.issue.startsWith(PROPOSAL_MARKER))
  assert.ok(docs.pullRequest.startsWith(PROPOSAL_MARKER))
})

test('a plugin name cannot forge a line of the title or the issue', () => {
  const docs = render(passing, false, 'evil\n## Forged\n- item')
  assert.equal(docs.title.includes('\n'), false)
  assert.equal(docs.issue.split('\n').some(line => line.startsWith('## Forged')), false)
})
