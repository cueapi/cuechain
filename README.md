# @cueapi/cuechain

> Cuechain is not an LLM chaining framework. It is a contract verification primitive for TypeScript pipelines.

[![CI](https://github.com/cueapi/cuechain/actions/workflows/ci.yml/badge.svg)](https://github.com/cueapi/cuechain/actions)
[![npm](https://img.shields.io/npm/v/@cueapi/cuechain)](https://www.npmjs.com/package/@cueapi/cuechain)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## The Problem

Imagine you ask a robot to bake a cake in six steps. At step 1, the robot grabs a tennis ball instead of an egg. It doesn't notice. It "cracks" the tennis ball, adds flour, mixes, pours, bakes, and announces "cake is done." From the outside, everything looks fine. A scheduler would record the execution as successful. But what's on the table is not a cake.

Every non-trivial AI agent workflow is a chain of steps where one step's output feeds the next step's input. LLMs are non-deterministic. They return JSON that almost matches the schema, fields that are the right shape but wrong content, arrays with the wrong length. Without verification at every handoff, bad data propagates silently through the pipeline and surfaces far from its root cause.

**Cuechain catches the tennis ball at step 1.** It validates contracts between every step in a pipeline, runs quality gates on outputs, and feeds failure context back into retries so LLM-driven steps can self-correct.

## Install

```bash
npm install @cueapi/cuechain zod
```

Zod is a peer dependency. You probably already have it.

## Quickstart

```typescript
import { z } from 'zod'
import { defineStep, pipeline } from '@cueapi/cuechain'

// Step 1: Load data
const loadData = defineStep({
  name: 'load-data',
  input: z.object({ source: z.string() }),
  output: z.object({ text: z.string(), wordCount: z.number() }),
  run: async (input) => {
    const text = `Content from ${input.source}`
    return { text, wordCount: text.split(/\s+/).length }
  },
})

// Step 2: Summarize (with a gate and retry)
const summarize = defineStep({
  name: 'summarize',
  input: z.object({ text: z.string(), wordCount: z.number() }),
  output: z.object({ summary: z.string() }),
  gates: [
    (out) =>
      out.summary.length <= 200
        ? { ok: true }
        : { ok: false, reason: `Summary too long: ${out.summary.length} chars` },
  ],
  retry: { maxAttempts: 3, on: ['gate'] },
  run: async (input, failureContext) => {
    if (failureContext) {
      // Use failure context to self-correct
      return { summary: input.text.slice(0, 100) }
    }
    return { summary: input.text }
  },
})

// Step 3: Format
const format = defineStep({
  name: 'format',
  input: z.object({ summary: z.string() }),
  output: z.object({ formatted: z.string() }),
  run: async (input) => ({ formatted: `RESULT: ${input.summary}` }),
})

// Compose and run
const myPipeline = pipeline('my-pipeline')
  .step(loadData)
  .step(summarize)
  .step(format)

const result = await myPipeline.run({ source: 'doc.md' })

if (result.ok) {
  console.log(result.value.formatted)
} else {
  console.error(`Failed at ${result.failure.step}: ${result.failure.reason}`)
}
```

## The Five Primitives

### 1. Typed Steps

A step has an input schema, an output schema (both Zod), and an async `run` function. The runtime validates input before running and output after.

```typescript
const extractTitle = defineStep({
  name: 'extract-title',
  input: z.object({ draft: z.string() }),
  output: z.object({ title: z.string().max(80) }),
  run: async (input) => {
    const title = await callLLM(`Extract a title from: ${input.draft}`)
    return { title }
  },
})
```

### 2. Pipelines

A pipeline chains steps where each step's output feeds the next step's input. TypeScript enforces type compatibility at compile time. Runtime validates at every handoff.

```typescript
const draft = pipeline('draft-monthly')
  .step(loadProfile)   // { month: string } -> { profile: Profile }
  .step(generateDraft) // { profile: Profile } -> { draft: string }
  .step(extractTitle)  // { draft: string } -> { title: string }
```

Mismatched types fail the build, not the runtime.

### 3. Quality Gates

A gate is a pure synchronous function that checks a step's output beyond what a schema can express.

```typescript
const step = defineStep({
  name: 'validate-draft',
  input: z.object({ draft: z.string() }),
  output: z.object({ draft: z.string(), charCount: z.number() }),
  gates: [
    (out) =>
      out.charCount <= 280
        ? { ok: true }
        : { ok: false, reason: `Draft is ${out.charCount} chars, max 280` },
    (out) =>
      !out.draft.includes('<script>')
        ? { ok: true }
        : { ok: false, reason: 'Draft contains unsafe HTML' },
  ],
  run: async (input) => ({
    draft: input.draft,
    charCount: input.draft.length,
  }),
})
```

Gates are pure code, not LLM calls. Deterministic verification only.

### 4. Retry With Failure Context

When a step fails, Cuechain retries it with the failure reason passed as a second argument. For LLM-driven steps, this means the next prompt can include why the previous attempt failed.

```typescript
const step = defineStep({
  name: 'generate',
  input: z.object({ topic: z.string() }),
  output: z.object({ text: z.string() }),
  gates: [(out) => out.text.length < 500 ? { ok: true } : { ok: false, reason: 'too long' }],
  retry: { maxAttempts: 3, on: ['schema', 'gate'] },
  run: async (input, failureContext) => {
    const prompt = failureContext
      ? `Generate text about ${input.topic}. Previous attempt failed: ${failureContext.reason}`
      : `Generate text about ${input.topic}`
    return { text: await callLLM(prompt) }
  },
})
```

`failureContext` includes `{ reason, attempt, type }` where `type` is `'schema'`, `'gate'`, or `'exception'`.

### 5. Structured Failures

Pipelines return `Result<T>` — either success with a value, or a structured failure identifying exactly what went wrong.

```typescript
const result = await myPipeline.run(input)

if (!result.ok) {
  result.failure.step      // which step failed
  result.failure.reason    // human-readable reason
  result.failure.type      // 'schema_input' | 'schema_output' | 'gate' | 'exception'
  result.failure.attempts  // how many attempts were made
  result.failure.input     // what the step received
  result.failure.output    // what the step produced (if it got that far)
}
```

Prefer thrown exceptions? Use `.runOrThrow()`:

```typescript
try {
  const value = await myPipeline.runOrThrow(input)
} catch (error) {
  if (error instanceof PipelineError) {
    console.error(error.failure) // same structured failure
  }
}
```

## Introspection

```typescript
const desc = myPipeline.describe()
// {
//   name: 'my-pipeline',
//   steps: [
//     { name: 'load-data', inputSchema: {...}, outputSchema: {...}, gates: 0, retry: {...} },
//     { name: 'summarize', inputSchema: {...}, outputSchema: {...}, gates: 1, retry: {...} },
//   ]
// }
```

Schemas are serialized as JSON Schema via `zod-to-json-schema`.

## Handling Failures Safely

When a step fails, the `Failure` object contains the raw `input`, `output`, and `error.message` from the step. This is useful for debugging but may contain sensitive data if your step processes PII, API keys, or other confidential information.

**Before exposing failures to end users, logs, or monitoring systems, sanitize the failure object:**

```typescript
const result = await myPipeline.run(input)

if (!result.ok) {
  // Internal logging — full context
  logger.debug('Pipeline failure', result.failure)

  // User-facing — redact raw data
  const safeError = {
    step: result.failure.step,
    reason: result.failure.reason,
    type: result.failure.type,
    attempts: result.failure.attempts,
    // Omit: input, output (may contain sensitive data)
  }
  return { error: safeError }
}
```

A pipeline-level `onFailure` redaction hook is planned for v0.2.

## Cuechain + CueAPI

Cuechain verifies contracts between steps. [CueAPI](https://cueapi.ai) verifies outcomes against reality. Use one, use both.

**Standalone Cuechain:** run a contract-verified pipeline from any trigger — a button click, an HTTP handler, a test, a local script. No infrastructure required.

**Standalone CueAPI:** schedule a cue that fires a webhook. The handler does whatever it wants internally. No Cuechain required.

**Composed:** CueAPI fires on schedule, the handler invokes a Cuechain pipeline, the pipeline runs contract-verified steps and returns a structured result, the handler reports that result back to CueAPI as the outcome. Outcome verification at the temporal boundary, contract verification at the data boundary.

Cuechain does not import CueAPI. The relationship is compositional, not architectural.

## What Cuechain Is Not

- **Not a scheduler.** That's [CueAPI](https://cueapi.ai).
- **Not a durable execution engine.** That's Inngest, Trigger.dev, Temporal.
- **Not a functional effects system.** That's Effect-TS.
- **Not an LLM framework.** That's LangChain, LangGraph, Mastra. Cuechain runs any async function as a step.
- **Not a state machine.** That's XState.
- **Not a UI, dashboard, or hosted service.** It's a library. Zero infrastructure.

Narrow scope is the product.

## API

### `defineStep(config)`

Define a pipeline step.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Step identifier |
| `input` | `z.ZodType` | Yes | Input schema |
| `output` | `z.ZodType` | Yes | Output schema |
| `run` | `(input, failureContext?) => Promise<output>` | Yes | Step function |
| `gates` | `Gate[]` | No | Quality gate functions |
| `retry` | `{ maxAttempts?, on? }` | No | Retry config |

### `pipeline(name)`

Create a pipeline builder. Chain `.step()` to add steps.

### `Pipeline.run(input)`

Returns `Result<T>` — `{ ok: true, value }` or `{ ok: false, failure }`.

### `Pipeline.runOrThrow(input)`

Returns the value directly. Throws `PipelineError` on failure.

### `Pipeline.describe()`

Returns `PipelineDescription` with step metadata and JSON Schemas.

## License

MIT. Vector Apps Inc.
