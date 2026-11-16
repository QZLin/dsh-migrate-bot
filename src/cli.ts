#!/usr/bin/env node
import { writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfigFile, parseConfig } from './config/load.ts'
import { loadSecrets, secretValues } from './secrets.ts'
import { createActivities } from './activities/index.ts'
import { checkTree } from './activities/check-tree.ts'
import { maintainerCommits, pullRequestState } from './activities/proposal.ts'
import { declaredRelease, newest } from './domain/release.ts'
import { defaultBranch, excludeIgnoredPaths } from './git/worktree.ts'
import { GitHubClient, repositoryOf, slugOf, type Repository } from './github/client.ts'
import { writeGithubOutput } from './github/output.ts'
import { resolveTarget } from './github/releases.ts'
import { renderStepSummary, statusOf, writeStepSummary } from './github/summary.ts'
import { findPlugins, pluginNames } from './plugins.ts'
import { inline } from './render/text.ts'
import { StateStore } from './state/store.ts'
import { badgeOf } from './workflow/badge.ts'
import { InJobEngine } from './engine.ts'
import { decideStart } from './workflow/start.ts'
import type { MigrateConfig } from './config/schema.ts'
import type { MigrationInput } from './workflow/model.ts'
import type { MigrationView } from './workflow/projection.ts'

const USAGE = `usage: dsh-migrate <command> [options]

commands:
  bump                  bump the plugins to the target release, check them, and propose the result
  check                 run every check on the working tree against --target
  status                print the consumer state as JSON
  print-config          print the validated configuration

options:
  --workdir DIR         the plugin checkout (default: the current directory)
  --config FILE         the configuration (default: .github/dsh-migrate.yml when it exists)
  --target RELEASE      the dsh release to bump to, instead of the configured one
  --force               bump again to a dsh release already processed (skipped otherwise),
                        never while that release's proposal is open
  --skip-github         do not call the GitHub API; what such a run still writes is in the README (Run it locally)
`

const OPTIONS = {
  workdir: { type: 'string' },
  config: { type: 'string' },
  target: { type: 'string' },
  force: { type: 'boolean' },
  'skip-github': { type: 'boolean' },
} as const

type Options = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values']

/** Lines go to stdout unbuffered, so the workflow log reads in order. */
function log(message: string): void {
  writeSync(1, `${message}\n`)
}

interface Runtime {
  workdir: string
  env: NodeJS.ProcessEnv
  config: MigrateConfig
  secrets: readonly string[]
  repository: Repository | undefined
  github: { client: GitHubClient; repository: Repository; defaultBranch: string } | undefined
  store: StateStore
  home: string
  runId: string
  runUrl: string | undefined
}

function loadRuntime(options: Options, env: NodeJS.ProcessEnv): Runtime {
  const workdir = resolve(options.workdir ?? '.')
  const defaultConfig = join(workdir, '.github', 'dsh-migrate.yml')
  const configPath = options.config === undefined ? defaultConfig : resolve(workdir, options.config)
  let config: MigrateConfig
  try {
    config = loadConfigFile(configPath)
  } catch (error) {
    if (configPath !== defaultConfig || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    config = parseConfig({})
  }
  if (options.target !== undefined) config = { ...config, target: options.target }
  const loaded = loadSecrets([workdir, env.DSH_MIGRATE_APP_ROOT ?? workdir], { env })
  const repository = env.GITHUB_REPOSITORY === undefined || env.GITHUB_REPOSITORY === '' ? undefined : repositoryOf(env.GITHUB_REPOSITORY)
  const github = repository === undefined || loaded.githubToken === undefined || options['skip-github'] === true
    ? undefined
    : { client: new GitHubClient(loaded.githubToken, env), repository, defaultBranch: defaultBranch(workdir) }
  const runId = env.GITHUB_RUN_ID === undefined ? `local-${new Date().toISOString().replace(/[:.]/g, '-')}` : `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT ?? '1'}`
  const runUrl = env.GITHUB_RUN_ID === undefined || repository === undefined
    ? undefined
    : `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${slugOf(repository)}/actions/runs/${env.GITHUB_RUN_ID}`
  return {
    workdir,
    env,
    config,
    secrets: secretValues(env),
    repository,
    github,
    store: new StateStore(workdir, env),
    home: resolve(env.DSH_MIGRATE_HOME ?? join(workdir, '.dsh-migrate')),
    runId,
    runUrl,
  }
}

function engineFor(runtime: Runtime): InJobEngine {
  const activities = createActivities({
    workdir: runtime.workdir,
    config: runtime.config,
    env: runtime.env,
    github: runtime.github,
    home: runtime.home,
    runId: runtime.runId,
    ...(runtime.runUrl === undefined ? {} : { runUrl: runtime.runUrl }),
    secrets: runtime.secrets,
    log,
  })
  return new InJobEngine({
    store: runtime.store,
    activities,
    run: runtime.runId,
    secrets: runtime.secrets,
    log,
  })
}

function migrationInput(runtime: Runtime, target: MigrationInput['target'], verified: MigrationInput['target'] | undefined, proposal: MigrationInput['proposal']): MigrationInput {
  const { config } = runtime
  // The earliest release every plugin admits: the release they last worked on together.
  const declared = verified === undefined ? newest(findPlugins(runtime.workdir).flatMap(plugin => declaredRelease(plugin.manifest) ?? [])) : undefined
  const source = verified !== undefined ? { release: verified, origin: 'verified' as const } : declared === undefined ? undefined : { release: declared, origin: 'declared-peers' as const }
  return {
    target,
    ...(source === undefined ? {} : { source }),
    ...(proposal === undefined ? {} : { proposal }),
    settings: {
      checks: { boot: config.checks.boot.enabled, web: config.checks.web.enabled },
      publish: runtime.github !== undefined,
      ownVersion: config.bump.ownVersion,
    },
  }
}

function report(runtime: Runtime, engine: InJobEngine, view: MigrationView | undefined, extra: Record<string, string | undefined> = {}): void {
  const projection = engine.status()
  writeGithubOutput({
    ...(view === undefined ? {} : { status: statusOf(view.state), target_tag: view.target.tag, pull_request_url: view.context.proposal?.pullRequest.url }),
    verified_tag: projection.verified?.tag,
    badge_message: badgeOf(projection).message,
    ...extra,
  }, runtime.env)
  if (view !== undefined) writeStepSummary(renderStepSummary({ view, pluginName: pluginNames(runtime.workdir) }), runtime.env)
}

async function bump(runtime: Runtime, force: boolean): Promise<number> {
  if (findPlugins(runtime.workdir).length === 0) {
    process.stderr.write('the repository holds no plugin: no package.json that declares dsh.bundle, at its root or below it\n')
    writeGithubOutput({ status: 'error' }, runtime.env)
    return 1
  }
  const target = await resolveTarget(runtime.config.target)
  const engine = engineFor(runtime)
  await reconcileOpenProposal(runtime, engine)
  const projection = engine.status()
  const proposal = projection.open?.context.proposal
  const decision = decideStart({
    target,
    projection,
    force,
    maintainerCommits: proposal === undefined || runtime.github === undefined
      ? 0
      : await maintainerCommits(runtime.github.client, runtime.github.repository, proposal.pullRequest.number),
  })
  if (decision.action === 'skip') {
    log(`skipped (${decision.reason}): ${inline(decision.detail, 300)}`)
    report(runtime, engine, undefined, { status: 'skipped', target_tag: target.tag })
    return 0
  }
  excludeIgnoredPaths(runtime.workdir)
  log(`bumping to ${target.tag}${decision.supersedes === undefined ? '' : `, taking over the proposal of ${decision.supersedes}`}`)
  const view = await engine.start(target.version, migrationInput(runtime, target, projection.verified, decision.proposal), decision.supersedes)
  report(runtime, engine, view)
  // A failed check is reported in the proposal, not repaired; only a run that
  // concluded nothing at all fails the job.
  return view.state === 'failed' || view.state === 'error' ? 1 : 0
}

/**
 * Deliver the close of the open proposal's pull request when its own event never
 * arrived: a job that failed, or one GitHub cancelled while another of the
 * concurrency group waited. Without this a merged proposal would stay open, and
 * the next release would take a closed pull request over.
 */
async function reconcileOpenProposal(runtime: Runtime, engine: InJobEngine): Promise<void> {
  const open = engine.status().open
  const pullRequest = open?.context.proposal?.pullRequest.number
  if (open === undefined || pullRequest === undefined || runtime.github === undefined) return
  const state = await pullRequestState(runtime.github.client, runtime.github.repository, pullRequest)
  if (state.open) return
  log(`the proposal's pull request #${String(pullRequest)} was ${state.merged ? 'merged' : 'closed'} without its event reaching this Action; delivering it`)
  await engine.deliver(open.id, { type: 'pull-request.closed', number: pullRequest, merged: state.merged })
}

async function check(runtime: Runtime): Promise<number> {
  const target = await resolveTarget(runtime.config.target)
  excludeIgnoredPaths(runtime.workdir)
  const report = await checkTree(runtime.workdir, target, {
    config: runtime.config,
    cacheDir: join(runtime.home, 'dsh'),
    runDir: join(runtime.home, 'runs', runtime.runId),
    secrets: runtime.secrets,
  })
  for (const result of report.results) log(`${result.check}: ${result.outcome}${result.outcome === 'fail' ? ` (${inline(result.fingerprint, 200)})` : ''}`)
  log(`checks against ${target.tag}: ${report.ok ? 'pass' : `fail: ${report.detail}`}`)
  writeGithubOutput({ status: report.ok ? 'compatible' : 'failed', target_tag: target.tag }, runtime.env)
  return report.ok ? 0 : 1
}

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv.slice(2), options: OPTIONS, allowPositionals: true, strict: true })
  const command = positionals[0]
  const env = process.env
  switch (command) {
    case 'print-config':
      log(JSON.stringify(loadRuntime(values, env).config, null, 2))
      return 0
    case 'status':
      log(JSON.stringify(engineFor(loadRuntime(values, env)).status(), null, 2))
      return 0
    case 'bump':
      return await bump(loadRuntime(values, env), values.force === true)
    case 'check':
      return await check(loadRuntime(values, env))
    default:
      process.stderr.write(USAGE)
      return 2
  }
}

void main(process.argv).then((code) => {
  process.exitCode = code
}, (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
