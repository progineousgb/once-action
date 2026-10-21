import { pathToFileURL } from "node:url";

import { createMemoryStore, runIdempotent } from "../src/index.js";

type Order = {
  orderId: string;
  sku: string;
  qty: number;
};

export async function main(): Promise<string[]> {
  const store = createMemoryStore<Order>();
  let calls = 0;

  async function place(key: string, sku: string, qty: number) {
    return runIdempotent(store, key, { sku, qty }, async (input) => {
      calls += 1;
      return { orderId: "ord_1", sku: input.sku, qty: input.qty };
    });
  }

  const lines: string[] = [];
  lines.push(`fresh ${JSON.stringify(await place("checkout-4f2a", "pen", 2))}`);
  lines.push(`replay ${JSON.stringify(await place("checkout-4f2a", "pen", 2))}`);
  lines.push(`mismatch ${JSON.stringify(await place("checkout-4f2a", "pencil", 2))}`);

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = runIdempotent(store, "checkout-9b10", { sku: "pen", qty: 1 }, async (input) => {
    calls += 1;
    await gate;
    return { orderId: "ord_2", sku: input.sku, qty: input.qty };
  });
  lines.push(
    `conflict ${JSON.stringify(
      await runIdempotent(store, "checkout-9b10", { sku: "pen", qty: 1 }, async () => {
        calls += 1;
        return { orderId: "ord_skipped", sku: "pen", qty: 1 };
      }),
    )}`,
  );
  release();
  await pending;
  lines.push(`calls ${calls}`);
  return lines;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const lines = await main();
  for (const line of lines) {
    console.log(line);
  }
}
