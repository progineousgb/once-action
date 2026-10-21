import { fingerprintOf } from "./fingerprint.js";
import type { IdempotentResult, IdempotencyStore, RunIdempotentOptions } from "./types.js";

const MAX_KEY_LENGTH = 255;
const MAX_FINGERPRINT_LENGTH = 1024;

function invalidKey(key: string): boolean {
  return typeof key !== "string" || key.trim() === "" || key.length > MAX_KEY_LENGTH;
}

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
export async function runIdempotent<TInput, TValue>(
  store: IdempotencyStore<TValue>,
  key: string,
  input: TInput,
  run: (input: TInput) => Promise<TValue> | TValue,
  options?: RunIdempotentOptions<TInput>,
): Promise<IdempotentResult<TValue>> {
  if (invalidKey(key)) {
    return { ok: false, error: { code: "invalid_key" } };
  }

  const scope = options?.scope;
  if (scope !== undefined && (typeof scope !== "string" || scope.length > MAX_KEY_LENGTH)) {
    throw new TypeError("scope must be a string of at most 255 characters.");
  }
  const storeKey = scope === undefined ? key : `${scope.length}:${scope}:${key}`;

  const hashInput = options?.fingerprint ?? fingerprintOf;
  const fingerprint = hashInput(input);
  if (typeof fingerprint !== "string" || fingerprint.length === 0 || fingerprint.length > MAX_FINGERPRINT_LENGTH) {
    throw new TypeError("fingerprint must return a non-empty string of at most 1024 characters.");
  }

  const now = options?.now ?? Date.now;
  const claim = await store.claim(storeKey, fingerprint, now());
  if (!claim.claimed) {
    // A different payload owns the key even when the first call is still in flight.
    if (claim.record.fingerprint !== fingerprint) {
      return { ok: false, error: { code: "mismatch", key } };
    }
    if (claim.record.state === "inflight") {
      return { ok: false, error: { code: "conflict", key } };
    }
    return { ok: true, replayed: true, value: claim.record.value };
  }

  const token = claim.token;
  try {
    const value = await run(input);
    const saved = await store.complete(storeKey, token, value, now());
    if (!saved) {
      const current = await store.read(storeKey, now());
      if (current && current.state === "done" && current.fingerprint === fingerprint) {
        return { ok: true, replayed: true, value: current.value };
      }
      return { ok: false, error: { code: "conflict", key } };
    }
    return { ok: true, replayed: false, value };
  } catch (error) {
    await store.release(storeKey, token);
    throw error;
  }
}
