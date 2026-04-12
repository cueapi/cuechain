import type { z } from 'zod'

/**
 * Result of a quality gate check.
 * Gates are pure synchronous functions — no LLM calls, no async.
 */
export type GateResult =
  | { ok: true }
  | { ok: false; reason: string; context?: unknown }

/**
 * A quality gate function. Receives a step's validated output
 * and returns a pass/fail verdict.
 */
export type Gate<T> = (output: T) => GateResult

/**
 * Context passed to a step's `run` function on retry attempts.
 * Contains the reason the previous attempt failed, the attempt number,
 * and the failure type so the step can self-correct.
 */
export interface FailureContext {
  reason: string
  attempt: number
  type: 'schema' | 'gate' | 'exception'
}

/**
 * What kinds of failures should trigger a retry.
 */
export type RetryOn = 'schema' | 'gate' | 'exception'

/**
 * Retry configuration for a step.
 */
export interface RetryConfig {
  /** Maximum number of attempts (including the first). Default: 1 (no retry). */
  maxAttempts?: number
  /** Which failure types trigger a retry. Default: ['schema', 'gate'] */
  on?: RetryOn[]
}

/**
 * Configuration for defining a step.
 * Generic parameters are inferred value types, not Zod schema types.
 */
export interface StepConfig<TInput, TOutput> {
  name: string
  input: z.ZodType<TInput, z.ZodTypeDef, unknown>
  output: z.ZodType<TOutput, z.ZodTypeDef, unknown>
  gates?: Gate<TOutput>[]
  retry?: RetryConfig
  run: (input: TInput, failureContext?: FailureContext) => Promise<TOutput>
}

/**
 * A defined step — the unit of work in a pipeline.
 * Generic parameters are value types (what the step consumes/produces),
 * not Zod schema types. This allows compile-time type checking of
 * step-to-step handoffs without Zod subclass compatibility issues.
 */
export interface Step<TInput = unknown, TOutput = unknown> {
  readonly name: string
  readonly inputSchema: z.ZodType<TInput>
  readonly outputSchema: z.ZodType<TOutput>
  readonly gates: Gate<TOutput>[]
  readonly retry: Required<RetryConfig>
  readonly run: (input: TInput, failureContext?: FailureContext) => Promise<TOutput>
}

/**
 * Structured failure returned when a pipeline halts.
 */
export interface Failure {
  step: string
  reason: string
  type: 'schema_input' | 'schema_output' | 'gate' | 'exception'
  attempts: number
  input: unknown
  output?: unknown
}

/**
 * Pipeline result type. Success or structured failure.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; failure: Failure }

/**
 * Metadata returned by pipeline.describe().
 */
export interface PipelineDescription {
  name: string
  steps: StepDescription[]
}

export interface StepDescription {
  name: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  gates: number
  retry: Required<RetryConfig>
}

/**
 * Error thrown by .runOrThrow() on pipeline failure.
 */
export class PipelineError extends Error {
  constructor(public readonly failure: Failure) {
    super(`Pipeline failed at step "${failure.step}": ${failure.reason}`)
    this.name = 'PipelineError'
  }
}
