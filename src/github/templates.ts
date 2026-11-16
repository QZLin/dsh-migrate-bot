import { redactSecrets } from '../render/redact.ts'
import { inline } from '../render/text.ts'
import { formatWorkingTree, neutralizeEmbedHtml, wrapFenced } from './issue-format.ts'
import type { MigrationContext } from '../workflow/machine.ts'
import type { CheckResult } from '../workflow/model.ts'

/**
 * The text of a proposal: the pull request title and body, and the companion
 * issue that carries the full record.
 */

export interface ProposalDocuments {
  title: string
  issue: string
  pullRequest: string
}

const CHECK_LABEL: Record<CheckResult['check'], string> = {
  mechanical: 'Mechanical checks',
  boot: 'Boot check',
  web: 'Web check',
}

/** The hidden marker that identifies the proposal issue and pull request. */
export const PROPOSAL_MARKER = '<!-- dsh-migrate:proposal -->'

export function renderProposal(input: {
  context: MigrationContext
  pluginName: string
  /** The result of every check that ran, in the order they ran. */
  checks: readonly CheckResult[]
  diff: string
  /** Whether the pull request is a draft because a check failed. */
  draft: boolean
  /** The workflow run that produced the proposal, when known. */
  runUrl?: string | undefined
  /** Configured credential values to remove from every rendered field. */
  secrets?: readonly string[] | undefined
}): ProposalDocuments {
  const redact = (text: string): string => redactSecrets(text, input.secrets ?? [])
  const { context } = input
  const target = inline(context.input.target.tag, 80)
  const plugin = inline(input.pluginName, 120)
  const title = `Bump ${plugin} to DeepSeek Harness ${inline(context.input.target.version, 80)}`
  const failures = input.checks.filter(check => check.outcome === 'fail')
  const checkLines = input.checks.map(check => `- ${CHECK_LABEL[check.check]}: ${check.outcome}${check.outcome === 'fail' ? ` (${inline(redact(check.fingerprint), 200)})` : ''}`)
  const changeLines = context.changes.map(change => `- \`${inline(change.file, 200)}\` ${inline(change.field, 200)}: \`${inline(change.from, 80)}\` → \`${inline(change.to, 80)}\``)
  const summary = [
    `- Target release: \`${target}\``,
    `- Source release: ${context.input.source === undefined ? 'unknown' : `\`${inline(context.input.source.release.tag, 80)}\` (${context.input.source.origin})`}`,
    `- Bump: ${inline(redact(context.bumpDetail), 300)}`,
    ...(input.runUrl === undefined ? [] : [`- Workflow run: ${input.runUrl}`]),
    ...context.warnings.map(warning => `- Warning: ${inline(redact(warning), 300)}`),
  ].join('\n')
  const verdict = input.draft
    ? `The checks fail, so this pull request is a draft: it records what the bump changed, not a migration that is ready to merge. Repairing it is left to you; the Action does not change a plugin it could not verify.`
    : `The checks pass on \`${target}\`.`
  const failing = failures.map(check => `### ${CHECK_LABEL[check.check]}\n\n${wrapFenced(neutralizeEmbedHtml(redact(check.detail)))}`).join('\n\n')
  const issue = `${PROPOSAL_MARKER}
# Bump of ${plugin} to ${target}

${verdict}

## Summary

${summary}

## Changes

${changeLines.length === 0 ? '_The bump changed nothing._' : changeLines.join('\n')}

## Checks

${checkLines.length === 0 ? '_No check ran._' : checkLines.join('\n')}
${failing === '' ? '' : `\n## Failures\n\n${failing}\n`}
## Working tree

${formatWorkingTree(redact(input.diff))}
`
  const pullRequest = `${PROPOSAL_MARKER}
## Summary

${verdict}

This pull request raises \`${plugin}\` to DeepSeek Harness \`${target}\`. The companion issue carries every changed field and the full check output.

${summary}

## Changes

${changeLines.length === 0 ? '_The bump changed nothing._' : changeLines.join('\n')}

## Checks

${checkLines.length === 0 ? '_No check ran._' : checkLines.join('\n')}
${failing === '' ? '' : `\n${failures.map(check => wrapFenced(neutralizeEmbedHtml(redact(check.detail)))).join('\n\n')}\n`}
## Before merging

- [ ] The plugin still documents and exposes the entry points its users rely on.
- [ ] Merge with a merge commit, and wait for the workflow run before deleting \`dsh-migrate/proposal\`.
`
  return { title, issue, pullRequest }
}
