import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runMechanical } from '../mechanical/run.ts'
import { redactSecrets } from '../render/redact.ts'
import { withoutSecrets } from '../secrets.ts'
import { declaresClient, findPlugins } from '../plugins.ts'
import { bootProbe, normalizeSignature } from '../verify/boot.ts'
import { errorSummary } from '../mechanical/errors.ts'
import { ensureDsh, releaseCutoff, releaseTimes } from '../verify/dsh-install.ts'
import { hasClientSurface, webSmoke } from '../verify/web.ts'
import { presetPluginNames } from '../verify/bundle.ts'
import type { MigrateConfig } from '../config/schema.ts'
import type { ActivityRequest } from '../workflow/machine.ts'
import type { CheckName, CheckResult, Release } from '../workflow/model.ts'

/**
 * The check activity: one of the checks on the working tree, against the target
 * release. Every check is keyless.
 *
 * The result in the event log carries a bounded excerpt; the full output is kept
 * in the run directory, and the proposal quotes the excerpt.
 */

const EXCERPT = 2_000

export interface CheckOutput {
  outcome: CheckResult['outcome']
  fingerprint: string
  /** The full output, or why the check was skipped. */
  output: string
}

export interface CheckDeps {
  workdir: string
  config: MigrateConfig
  /** One cached dsh installation per release. */
  cacheDir: string
  /** Where full outputs are kept for this run. */
  runDir: string
  /** Configured credential values for persisted check output. */
  secrets?: readonly string[] | undefined
}

export class CheckRunner {
  private sequence = 0

  constructor(private readonly deps: CheckDeps) {}

  async run(request: Extract<ActivityRequest, { activity: 'check' }>, release: Release): Promise<CheckResult> {
    const output = await this.execute(request.check, release)
    this.sequence += 1
    const dir = join(this.deps.runDir, 'checks')
    mkdirSync(dir, { recursive: true })
    const safeOutput = redactSecrets(output.output, this.deps.secrets ?? [])
    writeFileSync(join(dir, `${String(this.sequence).padStart(2, '0')}-${request.check}.log`), safeOutput)
    return {
      check: request.check,
      outcome: output.outcome,
      fingerprint: output.outcome === 'fail' ? output.fingerprint : '',
      // A failure's end says what broke; why a check was skipped is said first.
      detail: safeOutput.length <= EXCERPT ? safeOutput : output.outcome === 'skipped' ? `${safeOutput.slice(0, EXCERPT)}…` : `…${safeOutput.slice(-EXCERPT)}`,
    }
  }

  /** The dsh binary of a release, or why it could not be installed. */
  private dsh(release: Release): string {
    const installed = ensureDsh(release.version, this.deps.cacheDir, { timeoutMs: this.deps.config.timeouts.commandMs })
    if (!installed.ok || installed.bin === undefined) {
      throw new Error(`could not install dsh ${release.version} for the checks: ${installed.detail}`)
    }
    return installed.bin
  }

  /** Whether the target release installs at all, without which no check can run. */
  install(release: Release): { bin: string } | { failure: string } {
    const installed = ensureDsh(release.version, this.deps.cacheDir, { timeoutMs: this.deps.config.timeouts.commandMs })
    return installed.ok && installed.bin !== undefined
      ? { bin: installed.bin }
      : { failure: `could not install dsh ${release.version} for the checks: ${installed.detail}` }
  }

  private async execute(check: CheckName, release: Release): Promise<CheckOutput> {
    const { workdir, config } = this.deps
    // Every check is keyless; none sees a token the Action holds.
    const env = withoutSecrets(process.env)
    switch (check) {
      case 'mechanical': {
        const found = findPlugins(workdir)
        // A tree with no plugin is checked at its root, where the shape scan says what it lacks.
        const plugins = found.length === 0 ? [{ dir: '', name: '' }] : found
        const named = plugins.length > 1
        // Pinned as the release was published, with the install's cutoff (`releaseCutoff`).
        const times = releaseTimes(config.timeouts.commandMs)
        const before = times === undefined ? undefined : releaseCutoff(times, release.version)
        const results = plugins.map(plugin => ({
          plugin,
          result: runMechanical(join(workdir, plugin.dir), config, { dshVersion: release.version, timeoutMs: config.timeouts.commandMs, before, env }),
        }))
        const failed = results.filter(({ result }) => !result.ok)
        if (failed.length > 0) {
          const first = failed[0] as (typeof failed)[number]
          const firstError = errorSummary(first.result.errors) || 'mechanical checks failed'
          return {
            outcome: 'fail',
            fingerprint: `mechanical: ${named ? `${first.plugin.name}: ` : ''}${normalizeSignature(firstError)}`,
            output: failed.map(({ plugin, result }) => `${named ? `## ${plugin.name} (${plugin.dir})\n` : ''}${result.errors || result.log}`).join('\n\n'),
          }
        }
        if (results.every(({ result }) => result.checks === 0)) {
          return { outcome: 'skipped', fingerprint: '', output: 'no plugin declares a build, typecheck or test command' }
        }
        return { outcome: 'pass', fingerprint: '', output: results.map(({ result }) => result.log).join('\n') }
      }
      case 'boot': {
        // A plugin with a browser half may need services only the web
        // composition provides; the web check loads it there.
        const plugins = findPlugins(workdir)
        const presetPlugins = new Set(config.checks.web.enabled ? presetPluginNames(workdir) : [])
        const headless = plugins.filter(plugin => !declaresClient(plugin) && !presetPlugins.has(plugin.name))
        if (plugins.length > 0 && headless.length === 0) {
          return { outcome: 'skipped', fingerprint: '', output: 'every plugin has a browser half (dsh.client) or declares an agent preset; the web check loads them in the web composition' }
        }
        const probe = await bootProbe({ workdir, bin: this.dsh(release), dshTag: release.tag, timeoutMs: config.checks.boot.timeoutMs, plugins: headless.length > 0 ? headless : undefined, env })
        return { outcome: probe.outcome === 'pass' ? 'pass' : 'fail', fingerprint: probe.signature, output: probe.detail }
      }
      case 'web': {
        if (!hasClientSurface(workdir) && presetPluginNames(workdir).length === 0) return { outcome: 'skipped', fingerprint: '', output: 'the plugin declares no dsh.client surface or preset' }
        const smoke = await webSmoke({ workdir, bin: this.dsh(release), timeoutMs: config.checks.web.timeoutMs, dshTag: release.tag, env })
        if (smoke.skipped !== undefined) return { outcome: 'skipped', fingerprint: '', output: smoke.skipped }
        return { outcome: smoke.ok ? 'pass' : 'fail', fingerprint: smoke.signature, output: smoke.detail }
      }
    }
  }
}
