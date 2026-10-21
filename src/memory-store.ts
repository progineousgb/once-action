import { randomUUID } from "node:crypto";

import { cloneValue } from "./clone.js";
import type { Claim, IdempotencyRecord, IdempotencyStore, MemoryStoreOptions } from "./types.js";

type Inflight = {
  state: "inflight";
  fingerprint: string;
  startedAt: number;
  token: string;
};

type Done<T> = {
  state: "done";
  fingerprint: string;
  startedAt: number;
  finishedAt: number;
  token: string;
  value: T;
};

type Entry<T> = Inflight | Done<T>;

function positive(name: string, value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number.`);
  }
  return value;
}

function toRecord<T>(entry: Entry<T>): IdempotencyRecord<T> {
  if (entry.state === "inflight") {
    return {
      state: "inflight",
      fingerprint: entry.fingerprint,
      startedAt: entry.startedAt,
    };
  }
  return {
    state: "done",
    fingerprint: entry.fingerprint,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    value: cloneValue(entry.value),
  };
}

/**
 * Process-local store. `claim` updates the map before it returns, so two
 * calls on this thread cannot both win the same key. A second OS process has
 * its own empty map.
 */
export function createMemoryStore<T>(options?: MemoryStoreOptions): IdempotencyStore<T> {
  const ttlMs = positive("ttlMs", options?.ttlMs);
  const inflightTtlMs = positive("inflightTtlMs", options?.inflightTtlMs);
  const maxEntries = positive("maxEntries", options?.maxEntries);
  const entries = new Map<string, Entry<T>>();
  let claimsSinceSweep = 0;

  function sweep(now: number): void {
    for (const [key, entry] of entries) {
      if (expired(entry, now)) {
        entries.delete(key);
      }
    }
  }

  function enforceLimit(): void {
    if (maxEntries === undefined) {
      return;
    }
    // Only finished entries are evicted. An in-flight entry is never dropped,
    // so a running action keeps its claim and a duplicate still sees a conflict.
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries) {
        return;
      }
      if (entry.state === "done") {
        entries.delete(key);
      }
    }
  }

  function expired(entry: Entry<T>, now: number): boolean {
    if (entry.state === "done") {
      return ttlMs !== undefined && now - entry.finishedAt >= ttlMs;
    }
    return inflightTtlMs !== undefined && now - entry.startedAt >= inflightTtlMs;
  }

  return {
    claim(key, fingerprint, now): Claim<T> {
      claimsSinceSweep += 1;
      if (claimsSinceSweep >= 1024) {
        claimsSinceSweep = 0;
        sweep(now);
      }
      const existing = entries.get(key);
      if (existing && !expired(existing, now)) {
        return { claimed: false, record: toRecord(existing) };
      }
      entries.delete(key);
      const entry: Inflight = {
        state: "inflight",
        fingerprint,
        startedAt: now,
        token: randomUUID(),
      };
      entries.set(key, entry);
      enforceLimit();
      return { claimed: true, token: entry.token };
    },

    complete(key, token, value, now): boolean {
      const existing = entries.get(key);
      if (!existing || existing.state !== "inflight" || existing.token !== token) {
        return false;
      }
      const stored = cloneValue(value);
      const done: Done<T> = {
        state: "done",
        fingerprint: existing.fingerprint,
        startedAt: existing.startedAt,
        finishedAt: now,
        token,
        value: stored,
      };
      entries.set(key, done);
      enforceLimit();
      return true;
    },

    release(key, token): void {
      const existing = entries.get(key);
      if (existing && existing.state === "inflight" && existing.token === token) {
        entries.delete(key);
      }
    },

    read(key, now): IdempotencyRecord<T> | undefined {
      const existing = entries.get(key);
      if (!existing || now !== undefined && expired(existing, now)) {
        return undefined;
      }
      return toRecord(existing);
    },
  };
}
