import { join } from 'node:path'
import { changedPaths, isTreeChanged, treeDiff } from '../git/worktree.ts'
import { pluginNames } from '../plugins.ts'
import { renderProposal } from '../github/templates.ts'
import { bumpTree } from './bump.ts'
import { CheckRunner } from './checks.ts'
import { publishProposal } from './proposal.ts'
import type { ActivityRunner } from '../engine.ts'
import type { MigrateConfig } from '../config/schema.ts'
import type { GitHubClient, Repository } from '../github/client.ts'
import type { CheckName, CheckResult } from '../workflow/model.ts'

/**
 * The activities: the only code the engine calls that has effects. Each one
 * answers one {@link ActivityRequest} with the event the machine expects.
 */

export interface ActivityDeps {
  workdir: string
  config: MigrateConfig
  env: NodeJS.ProcessEnv
  /** Absent when the run may not touch GitHub. */
  github: { client: GitHubClient; repository: Repository; defaultBranch: string } | undefined
  /** `DSH_MIGRATE_HOME`: dsh installations and run directories. */
  home: string
  runId: string
  runUrl?: string | undefined
  secrets: readonly string[]
  log: (message: string) => void
}

export function createActivities(deps: ActivityDeps): ActivityRunner {
  const runDir = join(deps.home, 'runs', deps.runId)
  const checks = new CheckRunner({ workdir: deps.workdir, config: deps.config, cacheDir: join(deps.home, 'dsh'), runDir, secrets: deps.secrets })
  /** The latest result of each check, for the proposal. */
  const results = new Map<CheckName, CheckResult>()

  return async (request, context) => {
    switch (request.activity) {
      case 'bump':
        return { event: { type: 'bump.done', ...bumpTree({ workdir: deps.workdir, target: context.input.target, ownVersion: context.input.settings.ownVersion }) } }
      case 'check': {
        const result = await checks.run(request, context.input.target)
        results.set(result.check, result)
        return { event: { type: 'check.done', result } }
      }
      case 'inspectTree':
        return { event: { type: 'tree.inspected', changed: isTreeChanged(deps.workdir), files: changedPaths(deps.workdir).length } }
      case 'publishProposal': {
        if (deps.github === undefined) throw new Error('publishing needs a GitHub token')
        const documents = renderProposal({
          context,
          pluginName: pluginNames(deps.workdir),
          checks: [...results.values()],
          diff: treeDiff(deps.workdir),
          draft: request.draft,
          ...(deps.runUrl === undefined ? {} : { runUrl: deps.runUrl }),
          secrets: deps.secrets,
        })
        return await publishProposal(
          { workdir: deps.workdir, github: deps.github.client, repository: deps.github.repository, defaultBranch: deps.github.defaultBranch, secrets: deps.secrets },
          context,
          documents,
          request.draft,
        )
      }
    }
  }
}
