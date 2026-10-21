import type { IdempotencyStore, MemoryStoreOptions } from "./types.js";
/**
 * Process-local store. `claim` updates the map before it returns, so two
 * calls on this thread cannot both win the same key. A second OS process has
 * its own empty map.
 */
export declare function createMemoryStore<T>(options?: MemoryStoreOptions): IdempotencyStore<T>;
