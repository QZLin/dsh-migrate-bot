import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InJobEngine, type ActivityRunner } from '../../src/engine.ts'
import { BADGE_FILE, logPath, serializeLog, StateStore, STATE_BRANCH } from '../../src/state/store.ts'
import { checkout, type Checkout } from '../support/repository.ts'
import { bumpEvent, failedEvent, input, logOf, passedEvent, proposal, proposedEvents } from '../support/migration.ts'
import type { ActivityRequest } from '../../src/workflow/machine.ts'
import type { MigrationEvent, Proposal } from '../../src/workflow/model.ts'

/**
 * Activities that bump the tree, answer every check with the same outcome, and
 * publish the given proposal.
 */
function scripted(published: Proposal, calls: ActivityRequest[] = [], check: MigrationEvent = passedEvent()): ActivityRunner {
  return async (request) => {
    calls.push(request)
    switch (request.activity) {
      case 'bump':
        return { event: bumpEvent() }
      case 'check':
        return { event: check }
      case 'inspectTree':
        return { event: { type: 'tree.inspected', changed: true, files: 1 } }
      case 'publishProposal':
        return { event: { type: 'proposal.published', proposal: { ...published, draft: request.draft } } }
    }
  }
}

function engine(repo: Checkout, activities: ActivityRunner, cwd = repo.work): InJobEngine {
  return new InJobEngine({ store: new StateStore(cwd), activities, run: 'test-run', log: () => {}, now: () => new Date('2026-10-10T00:00:00Z') })
}

const plain = input('0.2.0')

test('a passing migration runs from the bump to its proposal, and the state branch holds its log and badge', async () => {
  const repo = checkout()
  try {
    const calls: ActivityRequest[] = []
    const view = await engine(repo, scripted(proposal(9), calls)).start('0.2.0', plain)
    assert.equal(view.state, 'awaitingMerge')
    assert.deepEqual(calls.map(call => call.activity), ['bump', 'check', 'inspectTree', 'publishProposal'])
    const publish = calls.at(-1)
    assert.equal(publish?.activity === 'publishProposal' && publish.draft, false)

    const reader = new StateStore(repo.clone())
    const state = reader.read()
    assert.equal(state.logs.get('0.2.0')?.length, 1 + calls.length)
    assert.match(reader.readFile(BADGE_FILE) ?? '', /"message": "unverified \| dsh-v0\.2\.0 proposed"/)
    // The log was pushed right after the effect; the final write had nothing new.
    const subjects = repo.git(['log', '--format=%s', STATE_BRANCH], repo.remote).split('\n')
    assert.deepEqual(subjects, ['dsh-migrate: 0.2.0 publishProposal'])
  } finally {
    repo.cleanup()
  }
})

test('a failing check publishes a draft proposal instead of repairing the plugin', async () => {
  const repo = checkout()
  try {
    const calls: ActivityRequest[] = []
    const view = await engine(repo, scripted(proposal(9, true), calls, failedEvent())).start('0.2.0', plain)
    assert.equal(view.state, 'awaitingMerge')
    assert.equal(view.context.proposal?.draft, true)
    assert.equal(view.context.failure?.check, 'mechanical')
    // One pass of checks, then the proposal: nothing retries the failure.
    assert.deepEqual(calls.map(call => call.activity), ['bump', 'check', 'inspectTree', 'publishProposal'])
  } finally {
    repo.cleanup()
  }
})

test('a migration whose bump changed nothing and whose checks fail ends failed, with no proposal', async () => {
  const repo = checkout()
  try {
    const activities: ActivityRunner = async (request) => {
      switch (request.activity) {
        case 'bump':
          return { event: { type: 'bump.done', changes: [], detail: 'every plugin already names dsh-v0.2.0' } }
        case 'check':
          return { event: failedEvent() }
        case 'inspectTree':
          return { event: { type: 'tree.inspected', changed: false, files: 0 } }
        case 'publishProposal':
          throw new Error('nothing to publish')
      }
    }
    const view = await engine(repo, activities).start('0.2.0', plain)
    assert.equal(view.state, 'failed')
    assert.equal(view.context.proposal, undefined)
  } finally {
    repo.cleanup()
  }
})

test('a merged proposal verifies the release', async () => {
  const repo = checkout()
  try {
    await engine(repo, scripted(proposal(9))).start('0.2.0', plain)
    const later = engine(repo, scripted(proposal(9)), repo.clone())
    const view = await later.deliver('0.2.0', { type: 'pull-request.closed', number: 9, merged: true, mergeSha: 'b'.repeat(40) })
    assert.equal(view.state, 'accepted')
    assert.equal(later.status().verified?.tag, 'dsh-v0.2.0')
  } finally {
    repo.cleanup()
  }
})

test('a newer release takes over the open proposal and the old migration ends superseded', async () => {
  const repo = checkout()
  try {
    const first = proposal(9)
    await engine(repo, scripted(first)).start('0.2.0', plain)
    const next = engine(repo, scripted(first), repo.clone())
    const view = await next.start('0.2.1', input('0.2.1', { proposal: first }), '0.2.0')
    assert.equal(view.state, 'awaitingMerge')
    const status = next.status()
    assert.equal(status.migrations.find(migration => migration.id === '0.2.0')?.state, 'superseded')
    assert.equal(status.open?.id, '0.2.1')
    assert.equal(status.migrations.filter(migration => migration.state === 'awaitingMerge').length, 1)
  } finally {
    repo.cleanup()
  }
})

test('an activity that throws ends the migration in error, and the error is recorded', async () => {
  const repo = checkout()
  try {
    const failing: ActivityRunner = async (request) => {
      if (request.activity === 'check') throw new Error('npm registry unreachable')
      return await scripted(proposal(9))(request, { input: plain, queue: [], changes: [], bumpDetail: '', failure: undefined, warnings: [], proposal: undefined, merged: false, concluded: undefined })
    }
    const view = await engine(repo, failing).start('0.2.0', plain)
    assert.equal(view.state, 'error')
    const log = new StateStore(repo.clone()).read().logs.get('0.2.0') ?? []
    const last = log.at(-1)
    assert.equal(last?.kind === 'event' && last.event.type === 'activity.error' && last.event.detail, 'npm registry unreachable')
  } finally {
    repo.cleanup()
  }
})

test('a seeded log replays to the state it records', async () => {
  const repo = checkout()
  try {
    const store = new StateStore(repo.work)
    assert.ok(store.write(undefined, new Map([[logPath('0.2.0'), serializeLog(logOf(input('0.2.0'), proposedEvents()))]]), 'seed').ok)
    const status = engine(repo, scripted(proposal(9)), repo.clone()).status()
    assert.deepEqual(status.migrations.map(view => `${view.id}:${view.state}`), ['0.2.0:awaitingMerge'])
    assert.equal(status.open?.id, '0.2.0')
  } finally {
    repo.cleanup()
  }
})

test('an event for a migration the state branch does not hold is refused', async () => {
  const repo = checkout()
  try {
    await assert.rejects(engine(repo, scripted(proposal(9))).deliver('9.9.9', { type: 'pull-request.closed', number: 1, merged: true }), /no migration 9\.9\.9/)
  } finally {
    repo.cleanup()
  }
})

test('live state events are unique transitions and end at the final state', async () => {
  const repo = checkout()
  try {
    const states: string[] = []
    const live = new InJobEngine({
      store: new StateStore(repo.work),
      activities: scripted(proposal(10)),
      run: 'state-run',
      log: () => {},
      onState: state => { states.push(state) },
      now: () => new Date('2026-10-10T00:00:00Z'),
    })
    const view = await live.start('0.2.0', plain)
    assert.deepEqual([...new Set(states)], states)
    assert.equal(states.at(-1), view.state)
    assert.equal(states.at(-1), 'awaitingMerge')
  } finally {
    repo.cleanup()
  }
})
