import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PipelineError, defineStep, pipeline } from '../src/index.js'

const double = defineStep({
  name: 'double',
  input: z.object({ value: z.number() }),
  output: z.object({ value: z.number() }),
  run: async (input) => ({ value: input.value * 2 }),
})

const toText = defineStep({
  name: 'to-string',
  input: z.object({ value: z.number() }),
  output: z.object({ text: z.string() }),
  run: async (input) => ({ text: `Result: ${input.value}` }),
})

describe('pipeline', () => {
  it('runs a single-step pipeline', async () => {
    const p = pipeline('single').step(double)
    const result = await p.run({ value: 5 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ value: 10 })
    }
  })

  it('chains multiple steps', async () => {
    const p = pipeline('multi').step(double).step(toText)
    const result = await p.run({ value: 21 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ text: 'Result: 42' })
    }
  })

  it('halts on input validation failure', async () => {
    const p = pipeline('invalid-input').step(double)
    const result = await p.run({ value: 'not a number' } as unknown as { value: number })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.step).toBe('double')
      expect(result.failure.type).toBe('schema_input')
      expect(result.failure.reason).toContain('Input validation failed')
    }
  })

  it('halts on output validation failure', async () => {
    const badStep = defineStep({
      name: 'bad-output',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.string() }),
      run: async (input) => ({ y: input.x }) as unknown as { y: string },
    })

    const p = pipeline('bad-output').step(badStep)
    const result = await p.run({ x: 5 })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.step).toBe('bad-output')
      expect(result.failure.type).toBe('schema_output')
      expect(result.failure.reason).toContain('Output validation failed')
    }
  })

  it('stops at the failing step in a multi-step pipeline', async () => {
    const fail = defineStep({
      name: 'fail-step',
      input: z.object({ value: z.number() }),
      output: z.object({ value: z.number() }),
      run: async () => {
        throw new Error('intentional failure')
      },
    })

    const unreachable = defineStep({
      name: 'unreachable',
      input: z.object({ value: z.number() }),
      output: z.object({ done: z.boolean() }),
      run: async () => ({ done: true }),
    })

    const p = pipeline('halt-test').step(double).step(fail).step(unreachable)
    const result = await p.run({ value: 1 })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.step).toBe('fail-step')
      expect(result.failure.type).toBe('exception')
    }
  })

  it('runOrThrow returns value on success', async () => {
    const p = pipeline('throw-success').step(double)
    const value = await p.runOrThrow({ value: 3 })
    expect(value).toEqual({ value: 6 })
  })

  it('runOrThrow throws PipelineError on failure', async () => {
    const p = pipeline('throw-fail').step(double)

    try {
      await p.runOrThrow({ value: 'bad' } as unknown as { value: number })
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineError)
      if (error instanceof PipelineError) {
        expect(error.failure.step).toBe('double')
        expect(error.failure.type).toBe('schema_input')
      }
    }
  })

  it('describe() returns pipeline metadata', () => {
    const p = pipeline('described').step(double).step(toText)
    const desc = p.describe()

    expect(desc.name).toBe('described')
    expect(desc.steps).toHaveLength(2)
    expect(desc.steps[0]?.name).toBe('double')
    expect(desc.steps[1]?.name).toBe('to-string')
    expect(desc.steps[0]?.inputSchema).toHaveProperty('type', 'object')
    expect(desc.steps[0]?.outputSchema).toHaveProperty('type', 'object')
    expect(desc.steps[0]?.gates).toBe(0)
  })
})
