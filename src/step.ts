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
  return {
    name: config.name,
    inputSchema: config.input as z.ZodType<TInput>,
    outputSchema: config.output as z.ZodType<TOutput>,
    gates: config.gates ?? [],
    retry: {
      maxAttempts: config.retry?.maxAttempts ?? 1,
      on: config.retry?.on ?? ['schema', 'gate'],
    },
    run: config.run,
  }
}
