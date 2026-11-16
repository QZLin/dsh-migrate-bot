/**
 * Generate the reference documents from the code that defines them.
 *
 *   node dist/scripts/references.js [--write]
 *
 * - docs/reference/configuration.md from the configuration schema
 * - docs/reference/workflow.md from the migration statechart
 *
 * Without `--write` it lists the documents that differ from the generated
 * text, which is how the `references` gate runs it.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { AnyStateNode } from 'xstate'
import { configSchema } from '../src/config/schema.ts'
import { checksFor, GUARD_DESCRIPTIONS, migrationMachine } from '../src/workflow/machine.ts'
import { migrationEventSchema, type Settings } from '../src/workflow/model.ts'
import { REPO_ROOT } from './repo.ts'

function page(description: string, title: string, intro: string, body: string[]): string {
  return ['---', 'kind: reference', `description: ${description}`, '---', '', `# ${title}`, '', intro, '', ...body, ''].join('\n')
}

function generatedFrom(source: string, script = 'scripts/references.ts'): string {
  return `This page is generated from \`${source}\` by \`${script}\`; edit the source, not this page.`
}

// ── configuration ──────────────────────────────────────────────────────────

interface JsonSchema {
  type?: string
  enum?: unknown[]
  default?: unknown
  description?: string
  format?: string
  properties?: Record<string, JsonSchema>
  additionalProperties?: JsonSchema | boolean
  items?: JsonSchema
}

function typeOf(schema: JsonSchema): string {
  if (schema.enum !== undefined) return schema.enum.map(value => `\`${String(value)}\``).join(' \\| ')
  if (schema.type === 'array') return `list of ${typeOf(schema.items ?? {})}`
  if (schema.format === 'uri') return 'URL'
  return schema.type ?? 'any'
}

function row(key: string, type: string, fallback: string, description: string | undefined, defaults: boolean): string {
  return defaults ? `| \`${key}\` | ${type} | ${fallback} | ${description ?? ''} |` : `| \`${key}\` | ${type} | ${description ?? ''} |`
}

function configRows(schema: JsonSchema, prefix: string, defaults = true): string[] {
  const rows: string[] = []
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const key = prefix === '' ? name : `${prefix}.${name}`
    if (child.properties !== undefined) {
      rows.push(...configRows(child, key, defaults))
    } else if (child.type === 'array' && child.items?.properties !== undefined) {
      rows.push(row(key, 'list', '—', child.description, defaults), ...configRows(child.items, `${key}[]`, defaults))
    } else if (typeof child.additionalProperties === 'object' && child.additionalProperties.properties !== undefined) {
      rows.push(row(key, 'mapping', '—', child.description, defaults), ...configRows(child.additionalProperties, `${key}.<id>`, defaults))
    } else {
      const fallback = child.default === undefined || typeof child.default === 'object' ? '—' : `\`${String(child.default)}\``
      rows.push(row(key, typeOf(child), fallback, child.description, defaults))
    }
  }
  return rows
}

function configuration(): string {
  const schema = z.toJSONSchema(configSchema, { io: 'input' }) as JsonSchema
  return page(
    'Every key of .github/dsh-migrate.yml with its type, default and meaning.',
    'Configuration reference',
    `A consumer configures the Action in \`.github/dsh-migrate.yml\`. Every key is optional, and an unknown key is an error. ${generatedFrom('src/config/schema.ts')}`,
    ['| Key | Type | Default | Description |', '| --- | --- | --- | --- |', ...configRows(schema, '')],
  )
}

// ── workflow ───────────────────────────────────────────────────────────────

function name(node: AnyStateNode): string {
  return node.id.replace(/^migration\./, '')
}

function guardOf(transition: { guard?: unknown }): string {
  const guard = transition.guard
  if (guard === undefined) return '—'
  if (typeof guard === 'string') return `\`${guard}\``
  const { type, params } = guard as { type: string; params?: Record<string, unknown> }
  return params === undefined ? `\`${type}\`` : `\`${type}(${Object.values(params).map(String).join(', ')})\``
}

function activityOf(node: AnyStateNode): string {
  for (const action of node.entry) {
    if (typeof action !== 'object' || action === null || (action as { type?: unknown }).type !== 'run') continue
    const params = (action as { params?: unknown }).params
    if (typeof params === 'function') return 'computed from the context'
    const request = params as Record<string, unknown>
    return `\`${String(request.activity)}\` ${Object.entries(request).filter(([key]) => key !== 'activity').map(([key, value]) => `${key}=${String(value)}`).join(' ')}`.trim()
  }
  return ''
}

function states(node: AnyStateNode): AnyStateNode[] {
  return Object.values(node.states).flatMap(child => [child, ...states(child)])
}

function kindOf(node: AnyStateNode): string {
  if (node.type === 'final') return 'final'
  if (node.type === 'compound') return 'group'
  if (activityOf(node) !== '') return 'activity'
  if ((node.always ?? []).length > 0) return 'decision'
  return 'waiting'
}

function workflow(): string {
  const all = states(migrationMachine.root)
  const stateRows = all.map(node => `| \`${name(node)}\` | ${kindOf(node)} | ${activityOf(node)} | ${node.description ?? ''} |`)
  const transitions: string[] = []
  for (const node of [migrationMachine.root, ...all]) {
    for (const [event, list] of node.transitions) {
      for (const transition of list) {
        transitions.push(`| ${node === migrationMachine.root ? 'any' : `\`${name(node)}\``} | \`${event}\` | ${guardOf(transition)} | ${(transition.target ?? []).map((target: AnyStateNode) => `\`${name(target)}\``).join(', ') || 'stays'} |`)
      }
    }
    for (const transition of node.always ?? []) {
      transitions.push(`| \`${name(node)}\` | immediately | ${guardOf(transition)} | ${(transition.target ?? []).map((target: AnyStateNode) => `\`${name(target)}\``).join(', ')} |`)
    }
  }
  const top = (node: AnyStateNode): string => name(node).split('.')[0] ?? ''
  const edges = new Set<string>()
  for (const node of all) {
    const outgoing = [...[...node.transitions.values()].flat(), ...(node.always ?? [])]
    for (const transition of outgoing) {
      for (const target of transition.target ?? []) {
        if (top(target) !== top(node)) edges.add(`  ${top(node)} --> ${top(target)}`)
      }
    }
  }
  const finals = Object.values(migrationMachine.root.states).filter(node => node.type === 'final').map(node => `  ${name(node)} --> [*]`)
  const diagram = ['```mermaid', 'stateDiagram-v2', '  [*] --> start', ...edges, ...finals, '```']
  const guardRows = Object.keys(migrationMachine.implementations.guards).map((guard) => {
    const description = (GUARD_DESCRIPTIONS as Record<string, string>)[guard]
    if (description === undefined) throw new Error(`guard ${guard} has no description in GUARD_DESCRIPTIONS`)
    return `| \`${guard}\` | ${description} |`
  })
  const everyCheck: Settings = { checks: { boot: true, web: true }, publish: true, ownVersion: true }
  const eventRows = migrationEventSchema.options.map(option => `| \`${String(option.shape.type.value)}\` | ${Object.keys(option.shape).filter(key => key !== 'type').map(key => `\`${key}\``).join(', ')} |`)
  return page(
    'The migration statechart: every state, transition, guard, check pass and event.',
    'Workflow reference',
    `The migration workflow of one consumer and one target release, as the statechart in \`src/workflow/machine.ts\` defines it. ${generatedFrom('src/workflow/machine.ts')} The design is in [the workflow design](../design/workflow.md).`,
    [
      '## Overview',
      '',
      'Top-level states only; a transition out of a nested state is drawn from its parent. Any state goes to `error` on `activity.error`.',
      '',
      ...diagram,
      '',
      '## States',
      '',
      'An *activity* state asks the engine for one activity and leaves on its result. A *decision* state leaves immediately on the first guard that holds. A *waiting* state leaves only on an event from outside the job.',
      '',
      '| State | Kind | Activity | Description |',
      '| --- | --- | --- | --- |',
      ...stateRows,
      '',
      '## Transitions',
      '',
      'Transitions of one state are tried in order; the first whose guard holds is taken.',
      '',
      '| From | On | Guard | To |',
      '| --- | --- | --- | --- |',
      ...transitions,
      '',
      '## Guards',
      '',
      '| Guard | Holds when |',
      '| --- | --- |',
      ...guardRows,
      '',
      '## The checks',
      '',
      `A migration runs ${checksFor(everyCheck).join(', ')}, in that order, and stops at the first failure. A check the consumer turned off is left out.`,
      '',
      '## Events',
      '',
      'Every activity result and every event from outside the job, as the event log stores it.',
      '',
      '| Event | Fields |',
      '| --- | --- |',
      ...eventRows,
    ],
  )
}

/** Every reference document, by repository-relative path. */
export function generateReferences(): Map<string, string> {
  return new Map([
    ['docs/reference/configuration.md', configuration()],
    ['docs/reference/workflow.md', workflow()],
  ])
}

/** The reference documents whose file differs from the generated text. */
export function staleReferences(): string[] {
  const stale: string[] = []
  for (const [path, content] of generateReferences()) {
    let current = ''
    try {
      current = readFileSync(join(REPO_ROOT, path), 'utf8')
    } catch {
      // A missing document is a stale one.
    }
    if (current !== content) stale.push(path)
  }
  return stale
}

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--write')) {
    for (const [path, content] of generateReferences()) writeFileSync(join(REPO_ROOT, path), content)
  } else {
    const stale = staleReferences()
    if (stale.length > 0) {
      console.error(`stale: ${stale.join(', ')}; run node dist/scripts/references.js --write`)
      process.exit(1)
    }
  }
}
