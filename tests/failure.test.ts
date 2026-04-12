import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineStep, pipeline, PipelineError } from '../src/index.js'

describe('structured failures', () => {
  it('schema_input failure has correct shape', async () => {
    const step = defineStep({
      name: 'schema-in',
      input: z.object({ name: z.string(), age: z.number().int().positive() }),
      output: z.object({ greeting: z.string() }),
      run: async (input) => ({ greeting: `Hello ${input.name}` }),
    })

    const p = pipeline('input-fail').step(step)
    const result = await p.run({ name: 123, age: -5 } as unknown as {
      name: string
      age: number
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure).toEqual(
        expect.objectContaining({
          step: 'schema-in',
          type: 'schema_input',
          attempts: 0,
        }),
      )
      expect(result.failure.reason).toContain('Input validation failed')
    }
  })

  it('schema_output failure includes the invalid output', async () => {
    const step = defineStep({
      name: 'schema-out',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.string().min(5) }),
      run: async (_input) => ({ y: 'hi' }),
    })

    const p = pipeline('output-fail').step(step)
    const result = await p.run({ x: 1 })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.type).toBe('schema_output')
      expect(result.failure.output).toEqual({ y: 'hi' })
      expect(result.failure.input).toEqual({ x: 1 })
    }
  })

  it('gate failure includes the valid-but-gated output', async () => {
    const step = defineStep({
      name: 'gate-fail',
      input: z.object({ text: z.string() }),
      output: z.object({ text: z.string() }),
      gates: [
        (out) =>
          out.text.includes('@')
            ? { ok: false, reason: 'must not contain @ symbol' }
            : { ok: true },
      ],
      run: async (input) => ({ text: input.text }),
    })

    const p = pipeline('gate-struct').step(step)
    const result = await p.run({ text: 'user@example.com' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.type).toBe('gate')
      expect(result.failure.output).toEqual({ text: 'user@example.com' })
      expect(result.failure.reason).toContain('must not contain @')
    }
  })

  it('exception failure captures the error message', async () => {
    const step = defineStep({
      name: 'explode',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.number() }),
      run: async () => {
        throw new TypeError('cannot read property of undefined')
      },
    })

    const p = pipeline('exception').step(step)
    const result = await p.run({ x: 1 })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.type).toBe('exception')
      expect(result.failure.reason).toContain('cannot read property of undefined')
      expect(result.failure.attempts).toBe(1)
    }
  })

  it('PipelineError contains the full failure object', () => {
    const failure = {
      step: 'test',
      reason: 'test reason',
      type: 'gate' as const,
      attempts: 2,
      input: { x: 1 },
      output: { y: 2 },
    }

    const error = new PipelineError(failure)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PipelineError')
    expect(error.failure).toEqual(failure)
    expect(error.message).toContain('test')
    expect(error.message).toContain('test reason')
  })
})
