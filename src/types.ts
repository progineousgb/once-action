export type IdempotencyRecord<T> =
  | {
      state: "inflight";
      fingerprint: string;
      startedAt: number;
    }
  | {
      state: "done";
      fingerprint: string;
      startedAt: number;
      finishedAt: number;
      value: T;
    };

export type Claim<T> =
  | { claimed: true; token: string }
  | { claimed: false; record: IdempotencyRecord<T> };

/**
 * Persistence for one idempotency key.
 *
 * `claim` must be atomic: two overlapping calls for the same key cannot both
 * come back `claimed: true`. Check the current row and insert the in-flight
 * row in one step, with no await between them.
 *
 * `complete` and `release` must succeed only when `token` still owns the
 * in-flight row. A late caller whose lease expired has to get `false` from
 * `complete` and must leave the newer row in place.
 */
export interface IdempotencyStore<T> {
  claim(
    key: string,
    fingerprint: string,
    now: number,
  ): Promise<Claim<T>> | Claim<T>;
  complete(
    key: string,
    token: string,
    value: T,
    now: number,
  ): Promise<boolean> | boolean;
  release(key: string, token: string): Promise<void> | void;
  read(key: string): Promise<IdempotencyRecord<T> | undefined> | IdempotencyRecord<T> | undefined;
}

export type IdempotencyError =
  | { code: "mismatch"; key: string }
  | { code: "conflict"; key: string }
  | { code: "invalid_key" };

export type IdempotentResult<T> =
  | { ok: true; replayed: boolean; value: T }
  | { ok: false; error: IdempotencyError };

export type RunIdempotentOptions<TInput> = {
  now?: () => number;
  fingerprint?: (input: TInput) => string;
};

export type MemoryStoreOptions = {
  ttlMs?: number;
  inflightTtlMs?: number;
};

export type FormActionInput = {
  key: string;
  input: Record<string, string>;
};
