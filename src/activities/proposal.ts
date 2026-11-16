import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { BOT_EMAIL, botEnv, gitOut } from '../git/run.ts'
import { stageChanges } from '../git/worktree.ts'
import { slugOf, type GitHubClient, type Repository } from '../github/client.ts'
import { redactSecrets } from '../render/redact.ts'
import { formatLeftOutWorkflows } from '../github/issue-format.ts'
import { PROPOSAL_MARKER, type ProposalDocuments } from '../github/templates.ts'
import type { MigrationContext } from '../workflow/machine.ts'
import type { MigrationEvent, Proposal } from '../workflow/model.ts'

/**
 * Publish the proposal: one branch, one issue, one pull request per consumer.
 *
 * Every step finds what a previous attempt already created before creating
 * anything: the branch is force-pushed, and the issue and the pull request are
 * the inherited ones or the open ones carrying the proposal marker. A job that
 * is cancelled after an effect and retried therefore repeats none.
 *
 * A proposal whose checks failed is opened as a draft, so nothing suggests it is
 * ready to merge; a later migration that fixes the checks reuses the same issue
 * and pull request and marks it ready.
 *
 * The branch carries the default branch's `.github/workflows/`, as it is when
 * the proposal is pushed. GitHub refuses a push by a token without the
 * `workflows` permission when the branch's workflow files differ from the
 * default branch's, and the default branch can change them while the migration
 * runs. A workflow change the migration made itself is left out the same way,
 * and the proposal says so.
 */

export const PROPOSAL_BRANCH = 'dsh-migrate/proposal'
const WORKFLOWS = '.github/workflows'

const issueSchema = z.object({
  number: z.number(),
  html_url: z.string(),
  body: z.string().nullable().optional(),
  pull_request: z.unknown().optional(),
  user: z.object({ type: z.string() }).nullable().optional(),
  author_association: z.string().optional(),
})
/** Who may have opened the proposal issue: a bot account, as the Action's token is, or someone the repository trusts. Anyone can write the marker. */
const TRUSTED_AUTHORS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const pullSchema = z.object({ number: z.number(), html_url: z.string(), node_id: z.string(), draft: z.boolean() })

export interface ProposalDeps {
  workdir: string
  github: GitHubClient
  repository: Repository
  defaultBranch: string
  /** Configured credential values to remove from published reports. */
  secrets?: readonly string[] | undefined
}

export async function publishProposal(
  deps: ProposalDeps,
  context: MigrationContext,
  rendered: ProposalDocuments,
  draft: boolean,
): Promise<{ event: MigrationEvent; files: Map<string, string> }> {
  const repo = slugOf(deps.repository)
  const { workdir } = deps

  gitOut(['checkout', '-B', PROPOSAL_BRANCH], { cwd: workdir })
  stageChanges(workdir)
  const leftOut = alignWorkflows(workdir, deps.defaultBranch)
  const note = leftOut === '' ? '' : `\n${formatLeftOutWorkflows(redactSecrets(leftOut, deps.secrets))}`
  const documents = { ...rendered, issue: `${rendered.issue}${note}`, pullRequest: `${rendered.pullRequest}${note}` }
  gitOut(['commit', '--quiet', '--allow-empty', '-m', documents.title], { cwd: workdir, env: botEnv() })
  const headSha = gitOut(['rev-parse', 'HEAD'], { cwd: workdir })
  gitOut(['push', '--quiet', '--force', 'origin', `HEAD:refs/heads/${PROPOSAL_BRANCH}`], { cwd: workdir })

  const inherited = context.input.proposal
  const issue = inherited?.issue.number ?? (await deps.github.paginate(`/repos/${repo}/issues?state=open`, issueSchema))
    .find(candidate => candidate.pull_request === undefined && candidate.body?.includes(PROPOSAL_MARKER) === true
      && (candidate.user?.type === 'Bot' || TRUSTED_AUTHORS.has(candidate.author_association ?? '')))?.number
  const issueLink = issue === undefined
    ? await deps.github.rest('POST', `/repos/${repo}/issues`, issueSchema, { title: documents.title, body: documents.issue })
    : await deps.github.rest('PATCH', `/repos/${repo}/issues/${String(issue)}`, issueSchema, { title: documents.title, body: documents.issue, state: 'open' })

  const pullBody = `${documents.pullRequest}\nCloses #${String(issueLink.number)}\n`
  const pull = inherited?.pullRequest.number ?? (await deps.github.paginate(
    `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${deps.repository.owner}:${PROPOSAL_BRANCH}`)}`,
    pullSchema,
  ))[0]?.number
  const pullLink = pull === undefined
    ? await deps.github.rest('POST', `/repos/${repo}/pulls`, pullSchema, { title: documents.title, body: pullBody, head: PROPOSAL_BRANCH, base: deps.defaultBranch, draft })
    : await deps.github.rest('PATCH', `/repos/${repo}/pulls/${String(pull)}`, pullSchema, { title: documents.title, body: pullBody, state: 'open' })
  // REST accepts `draft` only on creation. Reusing a proposal needs the draft
  // conversion mutation, and its response must confirm the requested state.
  if (pullLink.draft !== draft) {
    const mutation = draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'
    await deps.github.graphql(
      `mutation UpdateProposalDraft($id: ID!) {
        proposal: ${mutation}(input: {pullRequestId: $id}) {
          pullRequest { isDraft }
        }
      }`,
      { id: pullLink.node_id },
      z.object({ proposal: z.object({ pullRequest: z.object({ isDraft: z.literal(draft) }) }) }),
    )
  }

  const proposal: Proposal = {
    branch: PROPOSAL_BRANCH,
    headSha,
    issue: { number: issueLink.number, url: issueLink.html_url },
    pullRequest: { number: pullLink.number, url: pullLink.html_url },
    draft,
  }
  return { event: { type: 'proposal.published', proposal }, files: new Map() }
}

/**
 * Stage the default branch's `.github/workflows/` in place of the tree's.
 * @returns the staged diff of the workflow changes this drops, empty when none.
 */
function alignWorkflows(workdir: string, defaultBranch: string): string {
  const leftOut = gitOut(['diff', '--cached', 'HEAD', '--', WORKFLOWS], { cwd: workdir })
  gitOut(['fetch', '--quiet', 'origin', `refs/heads/${defaultBranch}`], { cwd: workdir })
  const base = gitOut(['rev-parse', 'FETCH_HEAD^{commit}'], { cwd: workdir })
  gitOut(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', WORKFLOWS], { cwd: workdir })
  rmSync(join(workdir, WORKFLOWS), { recursive: true, force: true })
  if (gitOut(['ls-tree', '--name-only', base, '--', WORKFLOWS], { cwd: workdir }) !== '') {
    gitOut(['checkout', base, '--', WORKFLOWS], { cwd: workdir })
  }
  return leftOut
}

const pullStateSchema = z.object({ state: z.string(), merged: z.boolean().optional() })

/** Whether a proposal's pull request is still open, or how it was closed. */
export async function pullRequestState(github: GitHubClient, repository: Repository, pullRequest: number): Promise<{ open: true } | { open: false; merged: boolean }> {
  const pull = await github.rest('GET', `/repos/${slugOf(repository)}/pulls/${String(pullRequest)}`, pullStateSchema)
  return pull.state === 'open' ? { open: true } : { open: false, merged: pull.merged === true }
}

const commitSchema = z.object({
  author: z.object({ login: z.string() }).nullable(),
  commit: z.object({ author: z.object({ email: z.string() }).nullable() }),
})

/**
 * Commits on a proposal's pull request that this Action did not author: a
 * newer migration must not force-push over them.
 * @param github - a client that can read the consumer repository.
 * @param repository - the consumer repository.
 * @param pullRequest - the proposal's pull request number.
 */
export async function maintainerCommits(github: GitHubClient, repository: Repository, pullRequest: number): Promise<number> {
  const commits = await github.paginate(`/repos/${slugOf(repository)}/pulls/${String(pullRequest)}/commits`, commitSchema)
  return commits.filter(commit => commit.commit.author?.email !== BOT_EMAIL && commit.author?.login.endsWith('[bot]') !== true).length
}
