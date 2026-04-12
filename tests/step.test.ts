import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineStep } from '../src/index.js'

describe('defineStep', () => {
  it('creates a step with required fields', () => {
    const step = defineStep({
      name: 'test-step',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.string() }),
      run: async (input) => ({ y: String(input.x) }),
    })

    expect(step.name).toBe('test-step')
    expect(step.gates).toEqual([])
    expect(step.retry).toEqual({ maxAttempts: 1, on: ['schema', 'gate'] })
  })

  it('creates a step with gates and retry config', () => {
    const step = defineStep({
      name: 'gated-step',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.number() }),
      gates: [(out) => (out.y > 0 ? { ok: true } : { ok: false, reason: 'must be positive' })],
      retry: { maxAttempts: 3, on: ['gate'] },
      run: async (input) => ({ y: input.x * 2 }),
    })

    expect(step.gates).toHaveLength(1)
    expect(step.retry).toEqual({ maxAttempts: 3, on: ['gate'] })
  })

  it('preserves the run function', async () => {
    const step = defineStep({
      name: 'run-test',
      input: z.object({ val: z.string() }),
      output: z.object({ upper: z.string() }),
      run: async (input) => ({ upper: input.val.toUpperCase() }),
    })

    const result = await step.run({ val: 'hello' })
    expect(result).toEqual({ upper: 'HELLO' })
  })
})
