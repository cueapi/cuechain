import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineStep, pipeline } from '../src/index.js'
import type { FailureContext } from '../src/index.js'

describe('retry with failure context', () => {
  it('retries on schema failure and passes on second attempt', async () => {
    let attempts = 0

    const step = defineStep({
      name: 'retry-schema',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.string() }),
      retry: { maxAttempts: 3, on: ['schema'] },
      run: async (input, _failureContext) => {
        attempts++
        // First attempt returns wrong type, second returns correct
        if (attempts === 1) {
          return { y: 42 } as unknown as { y: string }
        }
        return { y: String(input.x) }
      },
    })

    const p = pipeline('retry-schema').step(step)
    const result = await p.run({ x: 7 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ y: '7' })
    }
    expect(attempts).toBe(2)
  })

  it('retries on gate failure and passes failure context', async () => {
    const contexts: (FailureContext | undefined)[] = []

    const step = defineStep({
      name: 'retry-gate',
      input: z.object({ draft: z.string() }),
      output: z.object({ title: z.string() }),
      gates: [
        (out) =>
          out.title.length <= 20
            ? { ok: true }
            : { ok: false, reason: `title too long: ${out.title.length} chars` },
      ],
      retry: { maxAttempts: 3, on: ['gate'] },
      run: async (input, failureContext) => {
        contexts.push(failureContext)
        // First attempt: too long. Second attempt: uses context to shorten.
        if (failureContext) {
          return { title: input.draft.slice(0, 15) }
        }
        return { title: input.draft.repeat(3) }
      },
    })

    const p = pipeline('retry-gate').step(step)
    const result = await p.run({ draft: 'A Draft Title' })

    expect(result.ok).toBe(true)
    expect(contexts).toHaveLength(2)
    expect(contexts[0]).toBeUndefined() // first attempt
    expect(contexts[1]).toBeDefined() // second attempt has context
    expect(contexts[1]?.type).toBe('gate')
    expect(contexts[1]?.attempt).toBe(1)
    expect(contexts[1]?.reason).toContain('title too long')
  })

  it('exhausts retries and returns structured failure', async () => {
    let attempts = 0

    const step = defineStep({
      name: 'exhaust-retries',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.number().positive() }),
      retry: { maxAttempts: 3, on: ['schema'] },
      run: async (_input) => {
        attempts++
        return { y: -1 } // always invalid
      },
    })

    const p = pipeline('exhaust').step(step)
    const result = await p.run({ x: 1 })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.step).toBe('exhaust-retries')
      expect(result.failure.type).toBe('schema_output')
      expect(result.failure.attempts).toBe(3)
      expect(result.failure.input).toEqual({ x: 1 })
      expect(result.failure.output).toEqual({ y: -1 })
    }
    expect(attempts).toBe(3)
  })

  it('retries on exception and passes failure context', async () => {
    let attempts = 0

    const step = defineStep({
      name: 'retry-exception',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.number() }),
      retry: { maxAttempts: 2, on: ['exception'] },
      run: async (input, failureContext) => {
        attempts++
        if (!failureContext) {
          throw new Error('transient failure')
        }
        return { y: input.x + 1 }
      },
    })

    const p = pipeline('retry-exception').step(step)
    const result = await p.run({ x: 10 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ y: 11 })
    }
    expect(attempts).toBe(2)
  })

  it('does not retry when failure type is not in retry.on', async () => {
    let attempts = 0

    const step = defineStep({
      name: 'no-retry-gate',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.number() }),
      gates: [(_out) => ({ ok: false, reason: 'always fails' })],
      retry: { maxAttempts: 3, on: ['schema'] }, // only retry on schema, not gate
      run: async (input) => {
        attempts++
        return { y: input.x }
      },
    })

    const p = pipeline('no-retry').step(step)
    const result = await p.run({ x: 1 })

    expect(result.ok).toBe(false)
    expect(attempts).toBe(1) // no retry because gate failures not in retry.on
  })

  it('does not retry when maxAttempts is 1', async () => {
    let attempts = 0

    const step = defineStep({
      name: 'single-attempt',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.string() }),
      retry: { maxAttempts: 1 },
      run: async (_input) => {
        attempts++
        return { y: 42 } as unknown as { y: string }
      },
    })

    const p = pipeline('single').step(step)
    const result = await p.run({ x: 1 })

    expect(result.ok).toBe(false)
    expect(attempts).toBe(1)
  })

  it('throws RangeError when maxAttempts is 0', () => {
    expect(() =>
      defineStep({
        name: 'bad-retry',
        input: z.object({ x: z.number() }),
        output: z.object({ y: z.number() }),
        retry: { maxAttempts: 0 },
        run: async (input) => ({ y: input.x }),
      }),
    ).toThrow(RangeError)
  })

  it('throws RangeError when maxAttempts exceeds 20', () => {
    expect(() =>
      defineStep({
        name: 'bad-retry',
        input: z.object({ x: z.number() }),
        output: z.object({ y: z.number() }),
        retry: { maxAttempts: 21 },
        run: async (input) => ({ y: input.x }),
      }),
    ).toThrow(RangeError)
  })

  it('throws RangeError when maxAttempts is not an integer', () => {
    expect(() =>
      defineStep({
        name: 'bad-retry',
        input: z.object({ x: z.number() }),
        output: z.object({ y: z.number() }),
        retry: { maxAttempts: 2.5 },
        run: async (input) => ({ y: input.x }),
      }),
    ).toThrow(RangeError)
  })

  it('accepts maxAttempts of 20 (upper bound)', async () => {
    const step = defineStep({
      name: 'max-retry',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.number() }),
      retry: { maxAttempts: 20 },
      run: async (input) => ({ y: input.x }),
    })
    expect(step.retry.maxAttempts).toBe(20)
  })
})
