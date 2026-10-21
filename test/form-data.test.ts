import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryStore, inputFromFormData, runIdempotent } from "../src/index.js";

test("string fields become the action input and the key stays out of it", () => {
  const form = new FormData();
  form.set("idempotencyKey", "checkout-form");
  form.set("sku", "pen");
  form.set("qty", "2");

  assert.deepEqual(inputFromFormData(form), {
    key: "checkout-form",
    input: { sku: "pen", qty: "2" },
  });
});

test("a custom key field is omitted from the fingerprint input", () => {
  const form = new FormData();
  form.set("key", "checkout-form");
  form.set("sku", "pen");

  assert.deepEqual(inputFromFormData(form, "key"), {
    key: "checkout-form",
    input: { sku: "pen" },
  });
});

test("the parsed form replays through runIdempotent", async () => {
  const form = new FormData();
  form.set("idempotencyKey", "checkout-form");
  form.set("sku", "pen");
  form.set("qty", "2");
  const parsed = inputFromFormData(form);
  const store = createMemoryStore<{ orderId: string }>();
  let calls = 0;

  const run = () =>
    runIdempotent(store, parsed.key, parsed.input, async () => {
      calls += 1;
      return { orderId: "ord_3" };
    });

  assert.deepEqual(await run(), { ok: true, replayed: false, value: { orderId: "ord_3" } });
  assert.deepEqual(await run(), { ok: true, replayed: true, value: { orderId: "ord_3" } });
  assert.equal(calls, 1);
});

test("a changed field on the same form key is a mismatch", async () => {
  const store = createMemoryStore<{ orderId: string }>();
  const first = new FormData();
  first.set("idempotencyKey", "checkout-form");
  first.set("sku", "pen");
  const second = new FormData();
  second.set("idempotencyKey", "checkout-form");
  second.set("sku", "pencil");

  const original = inputFromFormData(first);
  await runIdempotent(store, original.key, original.input, async () => ({ orderId: "ord_3" }));
  const changed = inputFromFormData(second);
  let calls = 0;
  const result = await runIdempotent(store, changed.key, changed.input, async () => {
    calls += 1;
    return { orderId: "ord_4" };
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, { ok: false, error: { code: "mismatch", key: "checkout-form" } });
});

test("files, repeated fields, and a missing key throw", () => {
  const file = new FormData();
  file.set("idempotencyKey", "checkout-form");
  file.set("note", new Blob(["hello"]), "note.txt");
  assert.throws(() => inputFromFormData(file), /file/);

  const repeated = new FormData();
  repeated.set("idempotencyKey", "checkout-form");
  repeated.append("sku", "pen");
  repeated.append("sku", "pencil");
  assert.throws(() => inputFromFormData(repeated), /repeated/);

  const missing = new FormData();
  missing.set("sku", "pen");
  assert.throws(() => inputFromFormData(missing), /missing/);
});
