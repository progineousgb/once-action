import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryStore, fingerprintOf, inputFromFormData, runIdempotent } from "../src/index.js";

test("a __proto__ form field is kept and changes the fingerprint", () => {
  const a = new FormData();
  a.append("idempotencyKey", "k");
  a.append("__proto__", "one");
  const b = new FormData();
  b.append("idempotencyKey", "k");
  b.append("__proto__", "two");
  const pa = inputFromFormData(a);
  assert.equal(Object.getPrototypeOf(pa.input), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(pa.input, "__proto__")?.value, "one");
  assert.notEqual(fingerprintOf(pa.input), fingerprintOf(inputFromFormData(b).input));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("scope keeps one user's stored result away from another user", async () => {
  const store = createMemoryStore<string>();
  await runIdempotent(store, "order-1", { sku: "pen" }, () => "alice-receipt", { scope: "alice" });
  const bob = await runIdempotent(store, "order-1", { sku: "pen" }, () => "bob-receipt", { scope: "bob" });
  assert.deepEqual(bob, { ok: true, replayed: false, value: "bob-receipt" });
  const again = await runIdempotent(store, "order-1", { sku: "pen" }, () => "x", { scope: "alice" });
  assert.deepEqual(again, { ok: true, replayed: true, value: "alice-receipt" });
});

test("scope prefixes cannot be forged through the key", async () => {
  const store = createMemoryStore<string>();
  await runIdempotent(store, "b:c", 1, () => "first", { scope: "a" });
  const other = await runIdempotent(store, "c", 1, () => "second", { scope: "a:b" });
  assert.equal(other.ok && other.replayed, false);
});

test("expired rows are swept so the map does not grow without bound", async () => {
  let t = 0;
  const store = createMemoryStore<number>({ ttlMs: 5 });
  for (let i = 0; i < 5000; i += 1) {
    await runIdempotent(store, `k${i}`, 1, () => i, { now: () => (t += 1) });
  }
  assert.equal(store.read("k0", t), undefined);
  let live = 0;
  for (let i = 0; i < 5000; i += 1) {
    if (store.read(`k${i}`) !== undefined) live += 1;
  }
  assert.ok(live < 1100, `live rows ${live}`);
});

test("maxEntries caps the store", async () => {
  const store = createMemoryStore<number>({ maxEntries: 10 });
  for (let i = 0; i < 100; i += 1) {
    await runIdempotent(store, `k${i}`, 1, () => i);
  }
  assert.equal(store.read("k0"), undefined);
  assert.notEqual(store.read("k99"), undefined);
});

test("twenty parallel duplicates run the action once", async () => {
  const store = createMemoryStore<number>();
  let calls = 0;
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      runIdempotent(store, "p", { a: 1 }, async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return 1;
      }),
    ),
  );
  assert.equal(calls, 1);
  assert.equal(results.filter((r) => !r.ok && r.error.code === "conflict").length, 19);
});

test("maxEntries never evicts an in-flight entry", async () => {
  const store = createMemoryStore<number>({ maxEntries: 2 });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const running = runIdempotent(store, "slow", 1, async () => {
    await gate;
    return 7;
  });
  for (let i = 0; i < 10; i += 1) {
    await runIdempotent(store, `k${i}`, 1, () => i);
  }
  assert.equal((await store.read("slow"))?.state, "inflight");
  const dup = await runIdempotent(store, "slow", 1, () => 99);
  assert.equal(dup.ok, false);
  release();
  assert.deepEqual(await running, { ok: true, replayed: false, value: 7 });
});
