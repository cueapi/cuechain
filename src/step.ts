import type { z } from 'zod'
import type { Step, StepConfig } from './types.js'

/**
 * Define a pipeline step with typed input/output schemas, optional quality gates,
 * and retry configuration.
 *
 * @example
 * ```ts
 * const extractTitle = defineStep({
 *   name: 'extract-title',
 *   input: z.object({ draft: z.string() }),
 *   output: z.object({ title: z.string().max(80) }),
 *   gates: [
 *     (out) => out.title.includes(':')
 *       ? { ok: false, reason: 'title must not contain colons' }
 *       : { ok: true }
 *   ],
 *   retry: { maxAttempts: 3, on: ['schema', 'gate'] },
 *   run: async (input, failureContext) => {
 *     return { title: 'extracted title' };
 *   }
 * });
 * ```
 */
export function defineStep<TInput, TOutput>(
  config: StepConfig<TInput, TOutput>,
): Step<TInput, TOutput> {
  const maxAttempts = config.retry?.maxAttempts ?? 1

  if (maxAttempts < 1 || maxAttempts > 20) {
    throw new RangeError(`maxAttempts must be between 1 and 20 (got ${maxAttempts})`)
  }

  if (!Number.isInteger(maxAttempts)) {
    throw new RangeError(`maxAttempts must be an integer (got ${maxAttempts})`)
  }

  return {
    name: config.name,
    inputSchema: config.input as z.ZodType<TInput>,
    outputSchema: config.output as z.ZodType<TOutput>,
    gates: config.gates ?? [],
    retry: {
      maxAttempts,
      on: config.retry?.on ?? ['schema', 'gate'],
    },
    run: config.run,
  }
}
