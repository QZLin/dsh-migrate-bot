import { z } from 'zod'

/**
 * The consumer configuration, `.github/dsh-migrate.yml`.
 *
 * This schema is the only definition of the configuration: `parseConfig`
 * validates against it, and `docs/reference/configuration.md` is generated from
 * it by `scripts/references.ts`. Every object is strict, so a misspelled or
 * removed key fails validation instead of being ignored.
 *
 * Nothing here selects a model: a migration bumps the plugin and runs the
 * checks its own manifest declares.
 */

const milliseconds = z.number().int().min(1000)

const checkSchema = (timeoutMs: number, what: string) => z.strictObject({
  enabled: z.boolean().default(true).describe(`Run the ${what}.`),
  timeoutMs: milliseconds.default(timeoutMs).describe(`Watchdog for one ${what}, in milliseconds.`),
})

export const configSchema = z.strictObject({
  target: z.string().min(1).default('latest')
    .describe('The dsh release to bump the plugins to: `latest`, a version such as `0.2.0-rc.2`, or a `dsh-v*` tag.'),
  bump: z.strictObject({
    ownVersion: z.boolean().default(true)
      .describe('Raise each plugin\'s own `version` by a patch during the dependency update.'),
  }).prefault({}),
  tests: z.strictObject({
    commands: z.array(z.string().min(1)).min(1).describe('Shell commands that replace the built-in mechanical checks; they run in each plugin\'s directory.'),
  }).optional(),
  checks: z.strictObject({
    boot: checkSchema(180_000, 'boot check').prefault({}),
    web: checkSchema(120_000, 'web check').prefault({}),
  }).prefault({}),
  timeouts: z.strictObject({
    commandMs: milliseconds.default(20 * 60_000).describe('Watchdog for one mechanical command.'),
  }).prefault({}),
})

export type MigrateConfig = z.output<typeof configSchema>
