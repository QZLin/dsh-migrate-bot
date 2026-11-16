/** Validate the YAML and executable step structure of every Actions workflow. */
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { z } from 'zod'
import { readText, rel, repoFiles, REPO_ROOT } from './repo.ts'

export interface WorkflowViolation {
  file: string
  detail: string
}

const stepSchema = z.object({
  uses: z.string().min(1).optional(),
  run: z.string().min(1).optional(),
}).refine(step => (step.uses !== undefined) !== (step.run !== undefined), 'a step must declare exactly one of uses or run')

const jobSchema = z.object({
  uses: z.string().min(1).optional(),
  steps: z.array(stepSchema).min(1).optional(),
}).refine(job => (job.uses !== undefined) !== (job.steps !== undefined), 'a job must declare steps or a reusable workflow, not both')

const workflowSchema = z.object({
  jobs: z.record(z.string().min(1), jobSchema).refine(jobs => Object.keys(jobs).length > 0, 'a workflow must declare at least one job'),
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

export function verifyWorkflows(): WorkflowViolation[] {
  return repoFiles(['.yml', '.yaml'], join(REPO_ROOT, '.github', 'workflows'))
    .flatMap(file => verifyWorkflowSource(readText(file), rel(file)))
}
