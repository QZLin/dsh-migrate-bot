/** Validate the YAML and executable step structure of the workflows and the Action manifest. */
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { z } from 'zod'
import { readText, rel, repoFiles, REPO_ROOT } from './repo.ts'

export interface WorkflowViolation {
  file: string
  detail: string
}

/**
 * A step of a workflow. Its `shell` is optional: a `run` step without one uses
 * the runner's default shell.
 */
const stepSchema = z.object({
  id: z.string().min(1).optional(),
  uses: z.string().min(1).optional(),
  run: z.string().min(1).optional(),
  shell: z.string().min(1).optional(),
}).refine(step => (step.uses !== undefined) !== (step.run !== undefined), 'a step must declare exactly one of uses or run')

/**
 * A step of a composite Action. `shell` is mandatory there, because a composite
 * Action has no default shell to fall back on.
 */
const actionStepSchema = stepSchema.refine(step => step.run === undefined || step.shell !== undefined, 'a run step must declare its shell')

const jobSchema = z.object({
  uses: z.string().min(1).optional(),
  steps: z.array(stepSchema).min(1).optional(),
}).refine(job => (job.uses !== undefined) !== (job.steps !== undefined), 'a job must declare steps or a reusable workflow, not both')

const workflowSchema = z.object({
  jobs: z.record(z.string().min(1), jobSchema).refine(jobs => Object.keys(jobs).length > 0, 'a workflow must declare at least one job'),
})

const actionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputs: z.record(z.string().min(1), z.object({ description: z.string().min(1) })).default({}),
  outputs: z.record(z.string().min(1), z.object({ description: z.string().min(1), value: z.string().min(1) })).default({}),
  runs: z.object({
    using: z.literal('composite'),
    steps: z.array(actionStepSchema).min(1),
  }),
})

/** The source is parsed, never executed; duplicate mapping keys are errors. */
export function verifyWorkflowSource(source: string, file: string): WorkflowViolation[] {
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    return document.errors.map(error => ({ file, detail: error.message.split('\n')[0] ?? 'invalid YAML' }))
  }
  try {
    const parsed = workflowSchema.safeParse(document.toJS())
    return parsed.success ? [] : parsed.error.issues.map(issue => ({ file, detail: `${issue.path.map(String).join('.')}: ${issue.message}` }))
  } catch (error) {
    return [{ file, detail: `could not decode YAML: ${error instanceof Error ? error.message : String(error)}` }]
  }
}

/**
 * The Action must be a composite Action: a consumer runs it on their own runner,
 * so no image has to exist and no container runtime is involved.
 */
export function verifyActionSource(source: string, file = 'action.yml'): WorkflowViolation[] {
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    return document.errors.map(error => ({ file, detail: error.message.split('\n')[0] ?? 'invalid YAML' }))
  }
  const parsed = actionSchema.safeParse(document.toJS())
  if (!parsed.success) {
    return parsed.error.issues.map(issue => ({ file, detail: `${issue.path.map(String).join('.')}: ${issue.message}` }))
  }
  // An output that names no step id silently resolves to an empty string.
  const stepIds = new Set(parsed.data.runs.steps.flatMap(step => step.id === undefined ? [] : [step.id]))
  return Object.entries(parsed.data.outputs).flatMap(([name, output]) => {
    const referenced = /\bsteps\.([^.]+)\.outputs\./.exec(output.value)?.[1]
    return referenced !== undefined && !stepIds.has(referenced)
      ? [{ file, detail: `output ${name} names step ${referenced}, which is not a step id` }]
      : []
  })
}

export function verifyWorkflows(): WorkflowViolation[] {
  return repoFiles(['.yml', '.yaml'], join(REPO_ROOT, '.github', 'workflows'))
    .flatMap(file => verifyWorkflowSource(readText(file), rel(file)))
}

export function verifyAction(): WorkflowViolation[] {
  return verifyActionSource(readText(join(REPO_ROOT, 'action.yml')))
}
