import type { ZodError } from 'zod'
import type { Failure, FailureContext, Gate, Result, Step } from './types.js'

/**
 * Format a ZodError into a human-readable reason string.
 */
function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('; ')
}

/**
 * Run quality gates against a step's output.
 * Returns the first failure, or null if all gates pass.
 */
function runGates(
  gates: Gate<unknown>[],
  output: unknown,
): { reason: string; context?: unknown } | null {
  for (const gate of gates) {
    const result = gate(output)
    if (!result.ok) {
      return { reason: result.reason, context: result.context }
    }
  }
  return null
}

/**
 * Execute a single step with retry logic.
 * Returns a Result with the validated output or a structured failure.
 */
export async function executeStep(
  step: Step<unknown, unknown>,
  input: unknown,
): Promise<Result<unknown>> {
  // Validate input schema
  const inputResult = step.inputSchema.safeParse(input)
  if (!inputResult.success) {
    return {
      ok: false,
      failure: {
        step: step.name,
        reason: `Input validation failed: ${formatZodError(inputResult.error)}`,
        type: 'schema_input',
        attempts: 0,
        input,
      },
    }
  }

  const validatedInput = inputResult.data
  const maxAttempts = step.retry.maxAttempts
  const retryOn = new Set(step.retry.on)

  let failureContext: FailureContext | undefined
  let lastFailure: Failure | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Run the step function
      const rawOutput = await step.run(validatedInput, failureContext)

      // Validate output schema
      const outputResult = step.outputSchema.safeParse(rawOutput)
      if (!outputResult.success) {
        const reason = `Output validation failed: ${formatZodError(outputResult.error)}`
        lastFailure = {
          step: step.name,
          reason,
          type: 'schema_output',
          attempts: attempt,
          input: validatedInput,
          output: rawOutput,
        }

        if (attempt < maxAttempts && retryOn.has('schema')) {
          failureContext = { reason, attempt, type: 'schema' }
          continue
        }
        return { ok: false, failure: lastFailure }
      }

      const validatedOutput = outputResult.data

      // Run quality gates
      const gateFailure = runGates(step.gates as Gate<unknown>[], validatedOutput)
      if (gateFailure) {
        lastFailure = {
          step: step.name,
          reason: `Gate failed: ${gateFailure.reason}`,
          type: 'gate',
          attempts: attempt,
          input: validatedInput,
          output: validatedOutput,
        }

        if (attempt < maxAttempts && retryOn.has('gate')) {
          failureContext = {
            reason: gateFailure.reason,
            attempt,
            type: 'gate',
          }
          continue
        }
        return { ok: false, failure: lastFailure }
      }

      // Success
      return { ok: true, value: validatedOutput }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      lastFailure = {
        step: step.name,
        reason: `Exception: ${reason}`,
        type: 'exception',
        attempts: attempt,
        input: validatedInput,
      }

      if (attempt < maxAttempts && retryOn.has('exception')) {
        failureContext = { reason, attempt, type: 'exception' }
        continue
      }
      return { ok: false, failure: lastFailure }
    }
  }

  // Should not reach here, but safety net
  return {
    ok: false,
    failure: lastFailure ?? {
      step: step.name,
      reason: 'Unknown failure',
      type: 'exception',
      attempts: maxAttempts,
      input: validatedInput,
    },
  }
}
