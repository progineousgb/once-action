import assert from "node:assert/strict";
import { test } from "node:test";

import { fingerprintOf } from "../src/index.js";

test("object key order does not change the fingerprint", () => {
  assert.equal(fingerprintOf({ b: 1, a: { d: true, c: "pen" } }), fingerprintOf({ a: { c: "pen", d: true }, b: 1 }));
});

test("array order and extra fields change the fingerprint", () => {
  assert.notEqual(fingerprintOf(["pen", "pencil"]), fingerprintOf(["pencil", "pen"]));
  assert.notEqual(fingerprintOf({ sku: "pen" }), fingerprintOf({ sku: "pen", qty: 1 }));
});

test("a number and its decimal string are different inputs", () => {
  assert.notEqual(fingerprintOf({ qty: 2 }), fingerprintOf({ qty: "2" }));
});

test("dates hash as instants, distinct from the same ISO string", () => {
  const iso = "2026-10-21T12:00:00.000Z";
  assert.equal(fingerprintOf(new Date(iso)), fingerprintOf(new Date(iso)));
  assert.notEqual(fingerprintOf(new Date(iso)), fingerprintOf(iso));
});

test("negative zero is distinct from zero", () => {
  assert.notEqual(fingerprintOf(-0), fingerprintOf(0));
});

test("undefined, non-finite numbers, classes, symbols, and cycles throw", () => {
  assert.throws(() => fingerprintOf({ qty: undefined }), /undefined/);
  assert.throws(() => fingerprintOf(Number.NaN), /NaN/);
  assert.throws(() => fingerprintOf(Number.POSITIVE_INFINITY), /Infinity/);
  class Sku {
    name = "pen";
  }
  assert.throws(() => fingerprintOf(new Sku()), /non-plain/);
  const box: { self?: unknown } = {};
  box.self = box;
  assert.throws(() => fingerprintOf(box), /circular/);
  assert.throws(() => fingerprintOf({ [Symbol("sku")]: "pen" }), /symbol key/);
});
