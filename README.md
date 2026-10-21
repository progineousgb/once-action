# once-action

once-action stores the return value of a function under a key you choose, and it is meant to be called from a Next.js Server Action. A later call with the same key and the same input receives the stored value. The same key with a different input returns a mismatch. A second call that arrives while the first call is still running returns a conflict.

Next.js 16.4.2, the stable release published on 15 October 2026, runs a Server Action as a POST. The framework checks the request `Origin`, limits the body size, and encrypts the action id. It does not store a result for a key. A disabled submit button does not cover a lost response, a second browser tab, or a retry of the same POST.

`@idempotix/next` (1.0.3) already covers the HTTP version of this problem for route handlers: it reads an `Idempotency-Key` header and stores a `Response`, including a 409 while the first request is in flight and a 422 when the body differs. A Server Action does not receive that header and does not return a `Response`. once-action stores the action's return value and compares its arguments. It does not replace that route-handler package.

Setting `dir` on `<html>` from a `[locale]` segment is a separate problem, and it is already a few lines in the root layout with `Intl.Locale`. This package does not do that.

## What you get

`runIdempotent` returns one of these plain objects. They are data, so a Server Action can return them to the client.

Same key, first time the input is seen:

```json
{"ok":true,"replayed":false,"value":{"orderId":"ord_1","sku":"pen","qty":2}}
```

Same key, same input, after the first call has finished:

```json
{"ok":true,"replayed":true,"value":{"orderId":"ord_1","sku":"pen","qty":2}}
```

Same key, different input:

```json
{"ok":false,"error":{"code":"mismatch","key":"checkout-4f2a"}}
```

Same key, same input, while the first call is still running:

```json
{"ok":false,"error":{"code":"conflict","key":"checkout-9b10"}}
```

A blank key, a key that is only whitespace, or a key longer than 255 characters:

```json
{"ok":false,"error":{"code":"invalid_key"}}
```

`invalid_key` does not carry the key. `mismatch` and `conflict` do.

## Install

The package is installed from GitHub. It is not published on npm.

```bash
npm install github:progineousgb/once-action
```

It declares a peer dependency of `next@>=16.4.2 <17`. Nothing in the module imports `next`. Node.js 20 or newer is required, because the memory store and the default fingerprint use `node:crypto`.

The command is the same on Linux, macOS, and Windows. Install Node.js 20 or newer first: on Linux use your distribution's package manager or nvm, on macOS use the installer from nodejs.org, Homebrew (`brew install node`), or nvm, and on Windows use the installer from nodejs.org or `winget install OpenJS.NodeJS.LTS`. Git has to be on your `PATH`, because npm clones the repository. On Windows, run the commands in PowerShell or Command Prompt.

### Runtime

The module imports `node:crypto`, so it runs in the Node.js runtime only. A Server Action or route that sets `export const runtime = "edge"` cannot use it. Server Actions use the Node.js runtime by default.

## Example

`examples/checkout.ts` places an order twice with the key `checkout-4f2a` and the input `{ sku: "pen", qty: 2 }`, then places a pencil with that same key, then starts a pen order on `checkout-9b10` and calls it again before the first call resolves.

This is the run from this repository on 21 October 2026, produced by `npm run example`. The lines below are that process's standard output.

```text
fresh {"ok":true,"replayed":false,"value":{"orderId":"ord_1","sku":"pen","qty":2}}
replay {"ok":true,"replayed":true,"value":{"orderId":"ord_1","sku":"pen","qty":2}}
mismatch {"ok":false,"error":{"code":"mismatch","key":"checkout-4f2a"}}
conflict {"ok":false,"error":{"code":"conflict","key":"checkout-9b10"}}
calls 2
```

`calls 2` is the number of times the order function actually ran: once for the pen on `checkout-4f2a`, and once for the in-flight order on `checkout-9b10`. The replay, the mismatch, and the conflict did not run it.

The same script is asserted by `test/example.test.ts`.

## Server Action

Keep the store in module scope. Creating it inside the action gives every call an empty map.

```ts
"use server";

import { createMemoryStore, inputFromFormData, runIdempotent } from "once-action";

type Receipt = { orderId: string; sku: string; qty: number };

const orders = createMemoryStore<Receipt>({ ttlMs: 24 * 60 * 60 * 1000 });

export async function placeOrder(_prev: unknown, formData: FormData) {
  const { key, input } = inputFromFormData(formData);
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty < 1 || input.sku === undefined || input.sku === "") {
    return { ok: false as const, error: { code: "invalid_qty" as const } };
  }

  const userId = await currentUserId();
  return runIdempotent(
    orders,
    key,
    { sku: input.sku, qty },
    async (fields) => createOrder(fields.sku, fields.qty),
    { scope: userId },
  );
}

async function currentUserId(): Promise<string> {
  return "user_1"; // read this from your session
}

async function createOrder(sku: string, qty: number): Promise<Receipt> {
  return { orderId: "ord_1", sku, qty };
}
```

On the client, mint the key when the form mounts and post it again if the user retries that same attempt. Mint a new key only when the next submit is a new order.

```tsx
"use client";

import { useActionState, useState } from "react";
import { placeOrder } from "./actions";

export function CheckoutForm() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(placeOrder, null);

  return (
    <form action={action}>
      <input type="hidden" name="idempotencyKey" value={key} />
      <input name="sku" defaultValue="pen" />
      <input name="qty" defaultValue="2" />
      <button type="submit" disabled={pending}>
        Place order
      </button>
      <button
        type="button"
        onClick={() => setKey(crypto.randomUUID())}
      >
        Start a new order
      </button>
      <pre>{JSON.stringify(state)}</pre>
    </form>
  );
}
```

`useActionState` passes the previous state and the `FormData`. `inputFromFormData` reads `idempotencyKey` as the key and every other string field as the input.

## FormData result

`test/form-data.test.ts` builds this form:

```text
idempotencyKey=checkout-form
sku=pen
qty=2
```

`inputFromFormData` returns:

```json
{"key":"checkout-form","input":{"sku":"pen","qty":"2"}}
```

The key is not inside `input`, so a retry that changes only the key is a different claim, and a retry that keeps the key and changes `sku` is a mismatch. The test then calls `runIdempotent` with that parsed value. The second call returns:

```json
{"ok":true,"replayed":true,"value":{"orderId":"ord_3"}}
```

and the action body has run once. A follow-up form with the same key and `sku=pencil` returns:

```json
{"ok":false,"error":{"code":"mismatch","key":"checkout-form"}}
```

## API

### `runIdempotent(store, key, input, run, options?)`

Returns `Promise<IdempotentResult<TValue>>`.

```ts
type IdempotentResult<T> =
  | { ok: true; replayed: boolean; value: T }
  | { ok: false; error: IdempotencyError };

type IdempotencyError =
  | { code: "mismatch"; key: string }
  | { code: "conflict"; key: string }
  | { code: "invalid_key" };
```

`run` is called only when this call wins the claim. `replayed` is `false` for that first success and `true` when the value came from the store.

`options.scope` namespaces the key, usually with a user or session id. The key comes from the client, so without a scope a second user who sends the same key and the same input receives the first user's stored result. Set a scope whenever the result is private.

`options.now` defaults to `Date.now`. Tests pass a clock so expiry does not depend on a real wait. `options.fingerprint` defaults to `fingerprintOf`. A custom function must return a non-empty string of at most 1024 characters. An empty fingerprint throws `TypeError` and does not claim the key.

A throw from `run`, from `fingerprint`, or from storing the value is rethrown after the in-flight row owned by this call is released. The thrown value is not the stored result. The next call with the same key can run again.

### `createMemoryStore(options?)`

Returns an `IdempotencyStore` backed by a `Map` in the current process.

- `ttlMs`: a finished row older than this many milliseconds can be claimed again. Omit it and finished rows stay until the process drops the store.
- `inflightTtlMs`: an in-flight row older than this many milliseconds can be claimed by a later call. Omit it and an in-flight row stays until `complete`, `release`, or process exit. The first call is not cancelled. If it finishes after the takeover, its `complete` fails and the newer stored value is the one a later replay returns.

- `maxEntries`: the most rows the map keeps. When a new claim goes over the limit, the oldest rows are dropped first.

Expired rows are swept every 1024 claims, so a store with `ttlMs` does not keep growing. All options, when set, have to be positive finite numbers. Set `inflightTtlMs` if an action can hang, otherwise a stuck call holds its key until the process restarts.

### `inputFromFormData(formData, keyField?)`

`keyField` defaults to `"idempotencyKey"`. Returns `{ key, input }` where `input` is a `Record<string, string>`. Throws `TypeError` when the key field is missing, the key field or any other field is repeated, a field is a file, or `keyField` is blank.

### `fingerprintOf(value)`

SHA-256 hex digest of a canonical encoding. Object keys are sorted by UTF-16 code unit. Arrays keep their order. `Date` values use `toISOString`. `-0` and `0` differ. `2` and `"2"` differ.

Accepted values are `null`, booleans, finite numbers, strings, dates, arrays, and plain objects (prototype `Object.prototype` or `null`). Anything else throws `TypeError`, including `undefined`, `NaN`, `Infinity`, functions, class instances, symbol keys, non-enumerable properties, circular references, and nesting deeper than 32.

### `IdempotencyStore<T>`

```ts
claim(key, fingerprint, now): Promise<Claim<T>> | Claim<T>
complete(key, token, value, now): Promise<boolean> | boolean
release(key, token): Promise<void> | void
read(key, now?): Promise<IdempotencyRecord<T> | undefined> | IdempotencyRecord<T> | undefined
```

`claim` has to be atomic. The check and the insert of the in-flight row happen in one step. Two callers must not both receive `{ claimed: true }`.

`complete` writes the value only when `token` still owns the in-flight row, and returns `false` otherwise. `release` deletes the row only for that same token. `read` returns a copy of a finished value when the store keeps its own copy, so a caller cannot edit the stored result by editing the object it received.

The memory store does this with a synchronous map update. A store shared by more than one server has to do the same thing in the database or cache (a conditional insert, a compare-and-set, or a unique constraint). This package does not ship a Redis or SQL adapter.

## Limits

The included store is one Node process. A second instance, or a new serverless isolate, starts empty. Two instances can both run the action for the same key. Use a shared `IdempotencyStore` when more than one process handles the action, or a unique constraint in the database around the write itself.

If `run` writes a row and then throws, the claim is released and a retry can write again. Return from `run` only after the side effect is durable. A value you return on purpose, including `{ ok: false, reason: "sold out" }`, is stored and replayed. A throw is not stored.

`redirect()` and `notFound()` from `next/navigation` throw. This module does not import them, so those throws release the in-flight row. Return a result from the action and redirect from the caller when the redirect itself has to be tied to the stored result.

`inflightTtlMs` shorter than the action lets a second call run while the first is still working. The late `complete` from the first token does not overwrite the newer row.

The stored value has to be structured-cloneable. That is the same kind of value a Server Action can already return. Functions, symbols, and class instances fail the store, the claim is released, and the error is a `TypeError`.

File fields are rejected by `inputFromFormData`. Hash the bytes yourself and pass the digest as a string if the file has to be part of the input.

A key longer than 255 characters returns `invalid_key`. The default fingerprint is a 64-character hex digest. A custom fingerprint longer than 1024 characters throws before `claim`.

Two calls with different keys both run, even when the input matches. The key is the identity of the attempt. Rotating it after every render, or inside the action, defeats the replay.

The memory store holds finished values until `ttlMs` elapses, `maxEntries` pushes them out, or the process exits. There is no `forget` method. Put only the result you are willing to keep, and set `ttlMs` for a long-running process.

Arabic text, locale segments, and the `dir` attribute are outside this package. A string of Arabic is a normal string input and is fingerprinted as UTF-8, which is enough for an English or Arabic shop to pass a product name through. The library does not set document direction.

## Tests

```bash
npm test
```

That typechecks, compiles `src` to `dist`, and runs the unit tests with `node --test`. No network and no browser. `npm run example` prints the checkout transcript above. Run `npm run lint` to check the code with ESLint.

## License

MIT. Copyright (c) 2026 Pro Gineous.
