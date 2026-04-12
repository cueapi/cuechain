/**
 * Three-step pipeline example for @cueapi/cuechain.
 *
 * Demonstrates:
 * - Schema validation on inputs and outputs
 * - A quality gate rejecting invalid content
 * - Retry with failure context for self-correction
 *
 * Run: pnpm tsx examples/three-step.ts
 */

import { z } from 'zod'
import { defineStep, pipeline } from '../src/index.js'

// --- Step 1: Load a document ---

const loadDocument = defineStep({
  name: 'load-document',
  input: z.object({ source: z.string() }),
  output: z.object({
    title: z.string(),
    body: z.string(),
    wordCount: z.number().int().positive(),
  }),
  run: async (input) => {
    // Simulate loading a document from a source
    console.log(`  [load-document] Loading from: ${input.source}`)
    const body =
      'Cuechain verifies contracts between pipeline steps. ' +
      'It catches bad data at every handoff so problems surface immediately, ' +
      'not three steps later when a downstream consumer silently produces garbage.'

    return {
      title: 'Why Contract Verification Matters',
      body,
      wordCount: body.split(/\s+/).length,
    }
  },
})

// --- Step 2: Transform the document into a summary ---

const summarize = defineStep({
  name: 'summarize',
  input: z.object({
    title: z.string(),
    body: z.string(),
    wordCount: z.number(),
  }),
  output: z.object({
    summary: z.string(),
    originalWordCount: z.number(),
    summaryWordCount: z.number(),
  }),
  gates: [
    // Gate: summary must be shorter than the original
    (out) =>
      out.summaryWordCount < out.originalWordCount
        ? { ok: true }
        : {
            ok: false,
            reason: `Summary (${out.summaryWordCount} words) must be shorter than original (${out.originalWordCount} words)`,
          },
    // Gate: summary must not be empty
    (out) =>
      out.summary.trim().length > 0
        ? { ok: true }
        : { ok: false, reason: 'Summary must not be empty' },
  ],
  retry: { maxAttempts: 3, on: ['gate'] },
  run: async (input, failureContext) => {
    if (failureContext) {
      console.log(`  [summarize] Retry attempt ${failureContext.attempt + 1}: ${failureContext.reason}`)
    }

    // Simulate an LLM generating a summary.
    // On first attempt, make it too long (to demo retry + gate).
    // On retry, use the failure context to produce a shorter one.
    let summary: string
    if (!failureContext) {
      // First attempt: too long (triggers gate failure)
      summary = `${input.body} And here is even more text that makes the summary longer than the original document, which defeats the purpose of summarization entirely.`
    } else {
      // Retry: actually summarize
      summary = `${input.title}: contract verification catches bad data at every pipeline step.`
    }

    return {
      summary,
      originalWordCount: input.wordCount,
      summaryWordCount: summary.split(/\s+/).length,
    }
  },
})

// --- Step 3: Format the result ---

const formatResult = defineStep({
  name: 'format-result',
  input: z.object({
    summary: z.string(),
    originalWordCount: z.number(),
    summaryWordCount: z.number(),
  }),
  output: z.object({
    formatted: z.string(),
    compressionRatio: z.number(),
  }),
  run: async (input) => {
    const ratio = 1 - input.summaryWordCount / input.originalWordCount
    return {
      formatted: `SUMMARY (${input.summaryWordCount}/${input.originalWordCount} words, ${Math.round(ratio * 100)}% compression):\n${input.summary}`,
      compressionRatio: Math.round(ratio * 100) / 100,
    }
  },
})

// --- Compose and run ---

const summarizePipeline = pipeline('summarize-document')
  .step(loadDocument)
  .step(summarize)
  .step(formatResult)

async function main() {
  console.log('Running three-step pipeline...\n')

  const result = await summarizePipeline.run({ source: 'docs/contract-verification.md' })

  if (result.ok) {
    console.log('\nPipeline succeeded!')
    console.log(result.value.formatted)
    console.log(`Compression ratio: ${result.value.compressionRatio}`)
  } else {
    console.error('\nPipeline failed!')
    console.error(`  Step: ${result.failure.step}`)
    console.error(`  Reason: ${result.failure.reason}`)
    console.error(`  Attempts: ${result.failure.attempts}`)
  }

  // Also demonstrate .describe()
  console.log('\n--- Pipeline metadata ---')
  const desc = summarizePipeline.describe()
  console.log(`Pipeline: ${desc.name}`)
  for (const step of desc.steps) {
    console.log(`  Step: ${step.name} (${step.gates} gates, max ${step.retry.maxAttempts} attempts)`)
  }
}

main().catch(console.error)
