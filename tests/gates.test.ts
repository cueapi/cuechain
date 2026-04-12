import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineStep, pipeline } from '../src/index.js'

describe('quality gates', () => {
  it('passes when gate returns ok: true', async () => {
    const step = defineStep({
      name: 'gated',
      input: z.object({ text: z.string() }),
      output: z.object({ text: z.string() }),
      gates: [(out) => (out.text.length > 0 ? { ok: true } : { ok: false, reason: 'empty' })],
      run: async (input) => ({ text: input.text.toUpperCase() }),
    })

    const p = pipeline('gate-pass').step(step)
    const result = await p.run({ text: 'hello' })
    expect(result.ok).toBe(true)
  })

  it('fails when gate returns ok: false', async () => {
    const step = defineStep({
      name: 'gated-fail',
      input: z.object({ n: z.number() }),
      output: z.object({ n: z.number() }),
      gates: [(out) => (out.n < 100 ? { ok: true } : { ok: false, reason: 'too large' })],
      run: async (input) => ({ n: input.n * 1000 }),
    })

    const p = pipeline('gate-fail').step(step)
    const result = await p.run({ n: 5 })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.type).toBe('gate')
      expect(result.failure.reason).toContain('too large')
      expect(result.failure.output).toEqual({ n: 5000 })
    }
  })

  it('runs multiple gates in order, stops at first failure', async () => {
    const step = defineStep({
      name: 'multi-gate',
      input: z.object({ text: z.string() }),
      output: z.object({ text: z.string() }),
      gates: [
        (out) => (out.text.length > 0 ? { ok: true } : { ok: false, reason: 'empty' }),
        (out) =>
          out.text.length < 10 ? { ok: true } : { ok: false, reason: 'too long (max 10 chars)' },
        (_out) => ({ ok: false, reason: 'this gate should not run' }),
      ],
      run: async (input) => ({ text: input.text.repeat(5) }),
    })

    const p = pipeline('multi-gate').step(step)
    const result = await p.run({ text: 'abc' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.reason).toContain('too long')
    }
  })

  it('gate failure includes context when provided', async () => {
    const step = defineStep({
      name: 'gate-context',
      input: z.object({ items: z.array(z.string()) }),
      output: z.object({ items: z.array(z.string()) }),
      gates: [
        (out) =>
          out.items.length === 3
            ? { ok: true }
            : {
                ok: false,
                reason: `expected 3 items, got ${out.items.length}`,
                context: { expected: 3, actual: out.items.length },
              },
      ],
      run: async (input) => input,
    })

    const p = pipeline('gate-ctx').step(step)
    const result = await p.run({ items: ['a', 'b'] })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.reason).toContain('expected 3 items, got 2')
    }
  })

  it('attributes thrown gate exceptions as type gate', async () => {
    const step = defineStep({
      name: 'throwing-gate',
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.number() }),
      gates: [
        () => {
          throw new Error('gate exploded')
        },
      ],
      run: async (input) => ({ y: input.x * 2 }),
    })

    const p = pipeline('throw-gate').step(step)
    const result = await p.run({ x: 5 })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.type).toBe('gate')
      expect(result.failure.reason).toContain('Gate threw: gate exploded')
    }
  })
})
