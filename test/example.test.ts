import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { main } from "../examples/checkout.js";

test("the checkout example matches the README", async () => {
  const lines = await main();
  assert.deepEqual(lines, [
    'fresh {"ok":true,"replayed":false,"value":{"orderId":"ord_1","sku":"pen","qty":2}}',
    'replay {"ok":true,"replayed":true,"value":{"orderId":"ord_1","sku":"pen","qty":2}}',
    'mismatch {"ok":false,"error":{"code":"mismatch","key":"checkout-4f2a"}}',
    'conflict {"ok":false,"error":{"code":"conflict","key":"checkout-9b10"}}',
    "calls 2",
  ]);

  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const line of lines) {
    assert.equal(readme.includes(line), true, line);
  }
  assert.equal(
    readme.includes('{"ok":true,"replayed":true,"value":{"orderId":"ord_3"}}'),
    true,
  );
});
