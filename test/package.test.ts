import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryStore, runIdempotent } from "../dist/index.js";

test("the built package replays a stored result", async () => {
  const store = createMemoryStore<number>();
  const first = await runIdempotent(store, "k", { n: 1 }, async () => 7);
  const second = await runIdempotent(store, "k", { n: 1 }, async () => 8);
  assert.deepEqual(first, { ok: true, replayed: false, value: 7 });
  assert.deepEqual(second, { ok: true, replayed: true, value: 7 });
});
