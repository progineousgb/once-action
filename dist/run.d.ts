import type { IdempotentResult, IdempotencyStore, RunIdempotentOptions } from "./types.js";
/**
 * Run `run` once for a key and a fingerprint of `input`.
 *
 * - Same key and same fingerprint, after the first call has returned: replay the stored value.
 * - Same key and a different fingerprint: `{ code: "mismatch" }`. The stored row is left as it is.
 * - Same key and same fingerprint while the first call is still running: `{ code: "conflict" }`.
 * - Blank, non-string, or overlong key: `{ code: "invalid_key" }` and `run` is not called.
 *
 * A throw from `run` deletes the in-flight row so a later call can try again.
 * The thrown value is not stored. `redirect()` and `notFound()` throw, so they
 * follow that path.
 */
export declare function runIdempotent<TInput, TValue>(store: IdempotencyStore<TValue>, key: string, input: TInput, run: (input: TInput) => Promise<TValue> | TValue, options?: RunIdempotentOptions<TInput>): Promise<IdempotentResult<TValue>>;
