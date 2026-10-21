import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryStore, runIdempotent } from "../src/index.js";
import { settle } from "./settle.js";

test("the first call stores a result and a repeat replays it", async () => {
  const store = createMemoryStore<{ id: string }>();
  let calls = 0;
  const run = () =>
    runIdempotent(store, "checkout-4f2a", { sku: "pen", qty: 2 }, async () => {
      calls += 1;
      return { id: "ord_1" };
    });

  assert.deepEqual(await run(), { ok: true, replayed: false, value: { id: "ord_1" } });
  assert.deepEqual(await run(), { ok: true, replayed: true, value: { id: "ord_1" } });
  assert.equal(calls, 1);
});

test("the same key with a different input returns mismatch and keeps the stored result", async () => {
  const store = createMemoryStore<{ id: string }>();
  let calls = 0;
  await runIdempotent(store, "k", { sku: "pen" }, async () => {
    calls += 1;
    return { id: "ord_1" };
  });

  const mismatch = await runIdempotent(store, "k", { sku: "pencil" }, async () => {
    calls += 1;
    return { id: "ord_2" };
  });
  const replay = await runIdempotent(store, "k", { sku: "pen" }, async () => {
    calls += 1;
    return { id: "ord_3" };
  });

  assert.deepEqual(mismatch, { ok: false, error: { code: "mismatch", key: "k" } });
  assert.deepEqual(replay, { ok: true, replayed: true, value: { id: "ord_1" } });
  assert.equal(calls, 1);
});

test("an in-flight duplicate returns conflict and a later retry replays", async () => {
  const store = createMemoryStore<string>();
  let calls = 0;
  let release: (value: string) => void = () => {};
  const gate = new Promise<string>((resolve) => {
    release = resolve;
  });

  const first = runIdempotent(store, "checkout-9b10", { sku: "pen" }, async () => {
    calls += 1;
    return gate;
  });
  const conflict = await runIdempotent(store, "checkout-9b10", { sku: "pen" }, async () => {
    calls += 1;
    return "skipped";
  });
  assert.deepEqual(conflict, { ok: false, error: { code: "conflict", key: "checkout-9b10" } });

  release("ord_2");
  assert.deepEqual(await first, { ok: true, replayed: false, value: "ord_2" });
  const replay = await runIdempotent(store, "checkout-9b10", { sku: "pen" }, async () => {
    calls += 1;
    return "ord_3";
  });
  assert.deepEqual(replay, { ok: true, replayed: true, value: "ord_2" });
  assert.equal(calls, 1);
});

test("a different input during an in-flight call is a mismatch", async () => {
  const store = createMemoryStore<string>();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = runIdempotent(store, "k", { sku: "pen" }, async () => {
    await gate;
    return "ord_1";
  });
  await settle();

  let calls = 0;
  const mismatch = await runIdempotent(store, "k", { sku: "pencil" }, async () => {
    calls += 1;
    return "ord_2";
  });
  assert.equal(calls, 0);
  assert.deepEqual(mismatch, { ok: false, error: { code: "mismatch", key: "k" } });

  release();
  assert.deepEqual(await pending, { ok: true, replayed: false, value: "ord_1" });
});

test("a thrown error releases the key so the retry runs", async () => {
  const store = createMemoryStore<string>();
  let calls = 0;
  await assert.rejects(
    () =>
      runIdempotent(store, "k", { sku: "pen" }, async () => {
        calls += 1;
        throw new Error("db down");
      }),
    /db down/,
  );
  assert.equal(await store.read("k"), undefined);

  const recovered = await runIdempotent(store, "k", { sku: "pen" }, async () => {
    calls += 1;
    return "ord_1";
  });
  assert.deepEqual(recovered, { ok: true, replayed: false, value: "ord_1" });
  assert.equal(calls, 2);
});

test("mutating a returned value does not change the replay", async () => {
  const store = createMemoryStore<{ n: number }>();
  const fresh = await runIdempotent(store, "k", { sku: "pen" }, async () => ({ n: 1 }));
  assert.equal(fresh.ok, true);
  if (!fresh.ok) {
    return;
  }
  fresh.value.n = 99;

  const seen = await store.read("k");
  assert.equal(seen?.state, "done");
  if (seen?.state === "done") {
    seen.value.n = 5;
  }

  const replay = await runIdempotent(store, "k", { sku: "pen" }, async () => ({ n: 2 }));
  assert.deepEqual(replay, { ok: true, replayed: true, value: { n: 1 } });
  if (replay.ok) {
    replay.value.n = 7;
  }
  const third = await runIdempotent(store, "k", { sku: "pen" }, async () => ({ n: 3 }));
  assert.deepEqual(third, { ok: true, replayed: true, value: { n: 1 } });
});

test("a non-cloneable result releases the key", async () => {
  const store = createMemoryStore<string | symbol>();
  await assert.rejects(
    () => runIdempotent(store, "k", { sku: "pen" }, async () => Symbol("order")),
    /structured-cloneable/,
  );
  assert.equal(await store.read("k"), undefined);

  const second = await runIdempotent(store, "k", { sku: "pen" }, async () => "ord_1");
  assert.deepEqual(second, { ok: true, replayed: false, value: "ord_1" });
});

test("blank and overlong keys do not run", async () => {
  const store = createMemoryStore<string>();
  let calls = 0;
  const run = async (key: string) =>
    runIdempotent(store, key, { sku: "pen" }, async () => {
      calls += 1;
      return "ord_1";
    });

  assert.deepEqual(await run(""), { ok: false, error: { code: "invalid_key" } });
  assert.deepEqual(await run("   "), { ok: false, error: { code: "invalid_key" } });
  assert.deepEqual(await run("k".repeat(256)), { ok: false, error: { code: "invalid_key" } });
  assert.equal(calls, 0);
  assert.equal(await store.read("k"), undefined);
});

test("different keys both run", async () => {
  const store = createMemoryStore<string>();
  let calls = 0;
  const run = (key: string) =>
    runIdempotent(store, key, { sku: "pen" }, async () => {
      calls += 1;
      return key;
    });

  assert.deepEqual(await run("a"), { ok: true, replayed: false, value: "a" });
  assert.deepEqual(await run("b"), { ok: true, replayed: false, value: "b" });
  assert.equal(calls, 2);
});

test("a finished row expires after ttlMs and can run again", async () => {
  const store = createMemoryStore<string>({ ttlMs: 1_000 });
  const now = { value: 0 };
  const clock = () => now.value;

  assert.deepEqual(
    await runIdempotent(store, "k", { sku: "pen" }, async () => "a", { now: clock }),
    { ok: true, replayed: false, value: "a" },
  );
  now.value = 999;
  assert.deepEqual(
    await runIdempotent(store, "k", { sku: "pen" }, async () => "b", { now: clock }),
    { ok: true, replayed: true, value: "a" },
  );
  now.value = 1_000;
  assert.deepEqual(
    await runIdempotent(store, "k", { sku: "pen" }, async () => "c", { now: clock }),
    { ok: true, replayed: false, value: "c" },
  );
});

test("an expired in-flight claim can be taken over and the late write loses", async () => {
  const store = createMemoryStore<string>({ inflightTtlMs: 1_000 });
  let calls = 0;
  let release: (value: string) => void = () => {};
  const gate = new Promise<string>((resolve) => {
    release = resolve;
  });
  const now = { value: 0 };

  const first = runIdempotent(
    store,
    "k",
    { sku: "pen" },
    async () => {
      calls += 1;
      return gate;
    },
    { now: () => now.value },
  );
  now.value = 1_000;
  const second = await runIdempotent(
    store,
    "k",
    { sku: "pen" },
    async () => {
      calls += 1;
      return "second";
    },
    { now: () => now.value },
  );

  assert.deepEqual(second, { ok: true, replayed: false, value: "second" });
  release("first");
  assert.deepEqual(await first, { ok: true, replayed: true, value: "second" });
  assert.equal(calls, 2);

  const third = await runIdempotent(store, "k", { sku: "pen" }, async () => "third", {
    now: () => now.value,
  });
  assert.deepEqual(third, { ok: true, replayed: true, value: "second" });
});

test("a custom fingerprint that returns an empty string does not claim", async () => {
  const store = createMemoryStore<string>();
  await assert.rejects(
    () => runIdempotent(store, "k", { sku: "pen" }, async () => "ord_1", { fingerprint: () => "" }),
    /fingerprint/,
  );
  assert.equal(await store.read("k"), undefined);
});

test("createMemoryStore rejects a non-positive ttl", () => {
  assert.throws(() => createMemoryStore({ ttlMs: 0 }), /ttlMs/);
  assert.throws(() => createMemoryStore({ inflightTtlMs: -1 }), /inflightTtlMs/);
});
