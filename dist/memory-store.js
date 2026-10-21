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
    const maxEntries = positive("maxEntries", options?.maxEntries);
    const entries = new Map();
    let claimsSinceSweep = 0;
    function sweep(now) {
        for (const [key, entry] of entries) {
            if (expired(entry, now)) {
                entries.delete(key);
            }
        }
    }
    function enforceLimit() {
        if (maxEntries === undefined) {
            return;
        }
        for (const key of entries.keys()) {
            if (entries.size <= maxEntries) {
                return;
            }
            entries.delete(key);
        }
    }
    function expired(entry, now) {
        if (entry.state === "done") {
            return ttlMs !== undefined && now - entry.finishedAt >= ttlMs;
        }
        return inflightTtlMs !== undefined && now - entry.startedAt >= inflightTtlMs;
    }
    return {
        claim(key, fingerprint, now) {
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
            const entry = {
                state: "inflight",
                fingerprint,
                startedAt: now,
                token: randomUUID(),
            };
            entries.set(key, entry);
            enforceLimit();
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
        read(key, now) {
            const existing = entries.get(key);
            if (!existing || now !== undefined && expired(existing, now)) {
                return undefined;
            }
            return toRecord(existing);
        },
    };
}
