import { z } from 'zod'

/**
 * The data the migration workflow is made of: its input, the events the machine
 * consumes, and the entries of the event log. Every type here is a zod schema,
 * because the event log is read back from the state branch and validated before
 * it is replayed.
 */

export const releaseSchema = z.strictObject({
  tag: z.string().min(1),
  version: z.string().min(1),
})
export type Release = z.infer<typeof releaseSchema>

/**
 * The checks a migration runs, in the order they run.
 *
 * All three are keyless and deterministic: they install the target release,
 * install the plugin, and run the commands it declares.
 */
export const CHECKS = ['mechanical', 'boot', 'web'] as const
export type CheckName = (typeof CHECKS)[number]

export const checkResultSchema = z.strictObject({
  check: z.enum(CHECKS),
  outcome: z.enum(['pass', 'fail', 'skipped']),
  /** The normalised first failing line; empty unless the check failed. */
  fingerprint: z.string(),
  /** A bounded excerpt of the output, or why the check was skipped. */
  detail: z.string(),
})
export type CheckResult = z.infer<typeof checkResultSchema>

export const linkSchema = z.strictObject({
  number: z.number().int().positive(),
  url: z.string().min(1),
})

export const proposalSchema = z.strictObject({
  branch: z.string().min(1),
  /** The commit the proposal branch was pushed at. */
  headSha: z.string().min(1),
  issue: linkSchema,
  pullRequest: linkSchema,
  /**
   * Whether the pull request is a draft. A migration whose checks failed still
   * proposes what it tried, so a maintainer reads the failure where the change
   * is; the draft says nothing is ready to merge.
   */
  draft: z.boolean().default(false),
})
export type Proposal = z.infer<typeof proposalSchema>

export const bumpChangeSchema = z.strictObject({
  /** The plugin the change belongs to, by package name. */
  plugin: z.string().min(1),
  /** The manifest, relative to the repository root. */
  file: z.string().min(1),
  /** The field that moved: `version`, or `dependencies.@deepseek-ai/dsh-cli`. */
  field: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
})
export type BumpChangeEntry = z.infer<typeof bumpChangeSchema>

export const settingsSchema = z.strictObject({
  checks: z.strictObject({ boot: z.boolean(), web: z.boolean() }),
  /** Whether a changed tree becomes a proposal on GitHub. */
  publish: z.boolean(),
  /** Whether each plugin's own `version` is raised by a patch as well. */
  ownVersion: z.boolean(),
})
export type Settings = z.infer<typeof settingsSchema>

export const migrationInputSchema = z.strictObject({
  target: releaseSchema,
  /** The release the plugin last worked on, and where that came from. */
  source: z.strictObject({
    release: releaseSchema,
    origin: z.enum(['verified', 'declared-peers']),
  }).optional(),
  /** The open proposal this migration supersedes when it publishes. */
  proposal: proposalSchema.optional(),
  settings: settingsSchema,
})
export type MigrationInput = z.infer<typeof migrationInputSchema>

/** The result of every activity, and every event from outside the job. */
export const migrationEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('bump.done'),
    /** Every field the bump changed, across every plugin of the repository. */
    changes: z.array(bumpChangeSchema),
    detail: z.string(),
  }),
  z.strictObject({ type: z.literal('check.done'), result: checkResultSchema }),
  z.strictObject({ type: z.literal('tree.inspected'), changed: z.boolean(), files: z.number().int().min(0) }),
  z.strictObject({ type: z.literal('proposal.published'), proposal: proposalSchema }),
  z.strictObject({ type: z.literal('activity.error'), activity: z.string().min(1), detail: z.string() }),
  z.strictObject({
    type: z.literal('pull-request.closed'),
    number: z.number().int().positive(),
    merged: z.boolean(),
    mergeSha: z.string().optional(),
  }),
  z.strictObject({ type: z.literal('proposal.superseded'), by: z.string().min(1) }),
])
export type MigrationEvent = z.infer<typeof migrationEventSchema>

/** One line of `migrations/<version>/events.jsonl`. */
export const logEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('started'),
    at: z.iso.datetime(),
    /** The workflow run that started it, or `local`. */
    run: z.string().min(1),
    input: migrationInputSchema,
  }),
  z.strictObject({ kind: z.literal('event'), at: z.iso.datetime(), event: migrationEventSchema }),
])
export type LogEntry = z.infer<typeof logEntrySchema>
