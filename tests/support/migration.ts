import { replay, project, type MigrationView, type Projection } from '../../src/workflow/projection.ts'
import type { MigrationContext } from '../../src/workflow/machine.ts'
import type { BumpChangeEntry, LogEntry, MigrationEvent, MigrationInput, Proposal, Settings } from '../../src/workflow/model.ts'

/**
 * Real machine states for tests, built by replaying a log rather than by
 * writing a context by hand, so a test cannot describe a state the machine
 * never reaches.
 */

export const AT = '2026-10-10T00:00:00.000Z'

export function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    checks: { boot: false, web: false },
    publish: true,
    ownVersion: true,
    ...overrides,
  }
}

export function input(version = '0.2.0', overrides: Partial<MigrationInput> = {}): MigrationInput {
  return { target: { tag: `dsh-v${version}`, version }, settings: settings(), ...overrides }
}

export function logOf(migrationInput: MigrationInput, events: readonly MigrationEvent[], run = 'test'): LogEntry[] {
  return [
    { kind: 'started', at: AT, run, input: migrationInput },
    ...events.map(event => ({ kind: 'event' as const, at: AT, event })),
  ]
}

export function proposal(number = 7, draft = false): Proposal {
  return {
    branch: 'dsh-migrate/proposal',
    headSha: 'a'.repeat(40),
    issue: { number: number - 1, url: `https://github.com/acme/plugin/issues/${String(number - 1)}` },
    pullRequest: { number, url: `https://github.com/acme/plugin/pull/${String(number)}` },
    draft,
  }
}

/** One dependency the bump rewrote. */
export function change(field = 'dependencies.@deepseek-ai/dsh-cli', from = '^0.1.7', to = '^0.2.0'): BumpChangeEntry {
  return { plugin: '@acme/plugin', file: 'package.json', field, from, to }
}

export function bumpEvent(changes: readonly BumpChangeEntry[] = [change()]): MigrationEvent {
  return { type: 'bump.done', changes: [...changes], detail: `${String(changes.length)} field(s) bumped` }
}

export function passedEvent(check: 'mechanical' | 'boot' | 'web' = 'mechanical'): MigrationEvent {
  return { type: 'check.done', result: { check, outcome: 'pass', fingerprint: '', detail: '' } }
}

export function failedEvent(check: 'mechanical' | 'boot' | 'web' = 'mechanical'): MigrationEvent {
  return { type: 'check.done', result: { check, outcome: 'fail', fingerprint: `${check}: TS2304`, detail: `error TS2304 in ${check}` } }
}

/** The events that take the default input to `awaitingMerge` with a passing proposal. */
export function proposedEvents(open: Proposal = proposal()): MigrationEvent[] {
  return [
    bumpEvent(),
    passedEvent(),
    { type: 'tree.inspected', changed: true, files: 2 },
    { type: 'proposal.published', proposal: open },
  ]
}

/** The events that take the default input to `awaitingMerge` with a draft proposal whose check failed. */
export function draftEvents(open: Proposal = proposal(7, true)): MigrationEvent[] {
  return [
    bumpEvent(),
    failedEvent(),
    { type: 'tree.inspected', changed: true, files: 2 },
    { type: 'proposal.published', proposal: open },
  ]
}

export function contextOf(migrationInput: MigrationInput, events: readonly MigrationEvent[]): MigrationContext {
  const replayed = replay(logOf(migrationInput, events))
  if (replayed === undefined) throw new Error('no run')
  return replayed.snapshot.context
}

export function projectionOf(logs: Record<string, LogEntry[]>): Projection {
  return project(new Map(Object.entries(logs)))
}

export function viewOf(migrationInput: MigrationInput, events: readonly MigrationEvent[]): MigrationView {
  const view = projectionOf({ [migrationInput.target.version]: logOf(migrationInput, events) }).migrations[0]
  if (view === undefined) throw new Error('no view')
  return view
}
