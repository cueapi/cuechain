# Scaffolding Decisions — @cueapi/cuechain v0.1

Decisions made during the initial v0.1 scaffold that weren't fully specified in the PRD. Recorded here so future contributors understand why things are shaped the way they are.

---

## 1. `zod-to-json-schema` as a regular dependency

**Decision:** `zod-to-json-schema` is a `dependency`, not a `peerDependency` or `devDependency`.

**Rationale:** It's only used by `.describe()` to serialize Zod schemas into JSON Schema. Making it a peer dep would force every consumer to install it even if they never call `.describe()`. Making it dev-only would break `.describe()` in production. As a regular dep it just works — the package is small (no transitive deps) and commonly co-installed with Zod anyway. Can be made a dynamic import in v0.2 if tree-shaking or bundle concerns arise.

---

## 2. Step generics use value types, not Zod schema types

**Decision:** `Step<TInput, TOutput>` where `TInput` and `TOutput` are inferred value types (e.g. `{ x: number }`), not Zod schema types (e.g. `z.ZodObject<{ x: z.ZodNumber }>`).

**Rationale:** TypeScript's structural type system makes `ZodObject<T>` not assignable to `ZodType<T>` because `ZodObject` has internal properties (`_cached`, `_getCached`, `shape`, etc.) that `ZodType` lacks. Using Zod schema types as generic params would break compile-time step-to-step type checking — the core value proposition. Value-level generics give clean type inference without fighting Zod's internal type hierarchy.

---

## 3. `PipelineBuilder` interface for the first `.step()` call

**Decision:** `pipeline()` returns a `PipelineBuilder` (with an unconstrained `.step()` method), not a `Pipeline<never, never>`.

**Rationale:** A `Pipeline<never, never>` would require the first step's input to accept `never`, which is impossible. The `PipelineBuilder` pattern lets the first `.step()` call set both `TInput` and `TOutput` freely, then subsequent `.step()` calls on the returned `Pipeline<TInput, TOutput>` enforce type-safe chaining. This is a standard builder pattern for TypeScript fluent APIs with deferred type inference.

---

## 4. Input validation failures don't count as retry attempts

**Decision:** If a step's input fails schema validation, the pipeline halts immediately with `attempts: 0`. Retries only apply to output schema failures, gate failures, and exceptions.

**Rationale:** Input validation failure means the pipeline's data flow is structurally broken — the previous step produced data that doesn't match what this step expects. Retrying the current step with the same invalid input would produce the same result. The fix is upstream, not in the current step. Counting it as an attempt would be misleading and waste retries on an unfixable condition.

---

## 5. npm publish requires terminal authentication

**Decision:** The v0.0.1 placeholder publish is not automated. It requires manual `npm login` + `npm publish --access public`.

**Rationale:** npm authentication involves interactive login or token management that shouldn't be committed to CI or automated scripts during initial scaffold. The `@cueapi` org scope on npm needs to be claimed and configured first. Once npm auth is set up and the org scope exists, CI-based publishing can be added for future releases.
