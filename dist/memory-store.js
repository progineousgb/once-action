import { randomUUID } from "node:crypto";
import { cloneValue } from "./clone.js";
function positive(name, value) {
    if (value === undefined) {
        return undefined;
    }
    if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive finite number.`);
    }
    return value;
}
function toRecord(entry) {
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
export function createMemoryStore(options) {
    const ttlMs = positive("ttlMs", options?.ttlMs);
    const inflightTtlMs = positive("inflightTtlMs", options?.inflightTtlMs);
    const entries = new Map();
    function expired(entry, now) {
        if (entry.state === "done") {
            return ttlMs !== undefined && now - entry.finishedAt >= ttlMs;
        }
        return inflightTtlMs !== undefined && now - entry.startedAt >= inflightTtlMs;
    }
    return {
        claim(key, fingerprint, now) {
            const existing = entries.get(key);
            if (existing && !expired(existing, now)) {
                return { claimed: false, record: toRecord(existing) };
            }
            const entry = {
                state: "inflight",
                fingerprint,
                startedAt: now,
                token: randomUUID(),
            };
            entries.set(key, entry);
            return { claimed: true, token: entry.token };
        },
        complete(key, token, value, now) {
            const existing = entries.get(key);
            if (!existing || existing.state !== "inflight" || existing.token !== token) {
                return false;
            }
            const stored = cloneValue(value);
            const done = {
                state: "done",
                fingerprint: existing.fingerprint,
                startedAt: existing.startedAt,
                finishedAt: now,
                token,
                value: stored,
            };
            entries.set(key, done);
            return true;
        },
        release(key, token) {
            const existing = entries.get(key);
            if (existing && existing.state === "inflight" && existing.token === token) {
                entries.delete(key);
            }
        },
        read(key) {
            const existing = entries.get(key);
            if (!existing) {
                return undefined;
            }
            return toRecord(existing);
        },
    };
}
