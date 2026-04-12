import { zodToJsonSchema } from 'zod-to-json-schema'
import { executeStep } from './runner.js'
import type { Failure, PipelineDescription, Result, Step } from './types.js'
import { PipelineError } from './types.js'

/**
 * A compiled pipeline that can be run, described, or run-or-throw.
 */
export interface Pipeline<TInput, TOutput> {
  /** Pipeline name */
  readonly name: string

  /**
   * Add a step to the pipeline. Returns a new pipeline with the step appended.
   * TypeScript enforces that the step's input type matches the previous step's output type.
   */
  step<TNext>(step: Step<TOutput, TNext>): Pipeline<TInput, TNext>

  /**
   * Run the pipeline. Returns a Result — either { ok: true, value } or { ok: false, failure }.
   * No exceptions escape.
   */
  run(input: TInput): Promise<Result<TOutput>>

  /**
   * Run the pipeline and throw a PipelineError on failure.
   * For developers who prefer thrown exceptions over Result types.
   */
  runOrThrow(input: TInput): Promise<TOutput>

  /**
   * Return structured metadata about the pipeline:
   * step names, JSON Schema for inputs/outputs, gate count, retry config.
   */
  describe(): PipelineDescription
}

/**
 * Initial pipeline builder returned by pipeline().
 * The first .step() call sets both input and output types.
 */
export interface PipelineBuilder {
  readonly name: string
  step<TInput, TOutput>(step: Step<TInput, TOutput>): Pipeline<TInput, TOutput>
}

/**
 * Internal pipeline implementation.
 */
class PipelineImpl<TInput, TOutput> implements Pipeline<TInput, TOutput> {
  constructor(
    readonly name: string,
    // Use Step<unknown, unknown> internally; type safety is at the API boundary
    private readonly steps: Step<unknown, unknown>[],
  ) {}

  step<TNext>(newStep: Step<TOutput, TNext>): Pipeline<TInput, TNext> {
    return new PipelineImpl<TInput, TNext>(this.name, [
      ...this.steps,
      newStep as Step<unknown, unknown>,
    ])
  }

  async run(input: TInput): Promise<Result<TOutput>> {
    let current: unknown = input

    for (const step of this.steps) {
      const result = await executeStep(step, current)
      if (!result.ok) {
        return result as { ok: false; failure: Failure }
      }
      current = result.value
    }

    return { ok: true, value: current as TOutput }
  }

  async runOrThrow(input: TInput): Promise<TOutput> {
    const result = await this.run(input)
    if (!result.ok) {
      throw new PipelineError(result.failure)
    }
    return result.value
  }

  describe(): PipelineDescription {
    return {
      name: this.name,
      steps: this.steps.map((step) => ({
        name: step.name,
        inputSchema: zodToJsonSchema(step.inputSchema) as Record<string, unknown>,
        outputSchema: zodToJsonSchema(step.outputSchema) as Record<string, unknown>,
        gates: step.gates.length,
        retry: step.retry,
      })),
    }
  }
}

/**
 * Create a new pipeline with the given name.
 * Call .step() to add the first step — this sets the pipeline's input type.
 *
 * @example
 * ```ts
 * const myPipeline = pipeline('my-pipeline')
 *   .step(loadData)
 *   .step(transformData)
 *   .step(validateResult);
 *
 * const result = await myPipeline.run({ source: 'input.json' });
 * ```
 */
export function pipeline(name: string): PipelineBuilder {
  return {
    name,
    step<TInput, TOutput>(firstStep: Step<TInput, TOutput>): Pipeline<TInput, TOutput> {
      return new PipelineImpl<TInput, TOutput>(name, [firstStep as Step<unknown, unknown>])
    },
  }
}
