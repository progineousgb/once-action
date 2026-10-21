import { createHash } from "node:crypto";
const MAX_DEPTH = 32;
function sha256(text) {
    return createHash("sha256").update(text).digest("hex");
}
function canonical(value, depth, seen) {
    if (depth > MAX_DEPTH) {
        throw new TypeError("Input is nested too deeply to fingerprint.");
    }
    if (value === null) {
        return "null";
    }
    if (value === undefined) {
        throw new TypeError("Input contains undefined. Use null or omit the field.");
    }
    const valueType = typeof value;
    if (valueType === "string" || valueType === "boolean") {
        return JSON.stringify(value);
    }
    if (valueType === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError("Input contains NaN or Infinity.");
        }
        if (Object.is(value, -0)) {
            return "-0";
        }
        return JSON.stringify(value);
    }
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new TypeError("Input contains an invalid Date.");
        }
        return `date:${value.toISOString()}`;
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) {
            throw new TypeError("Input contains a circular reference.");
        }
        seen.add(value);
        const body = value.map((item) => canonical(item, depth + 1, seen)).join(",");
        seen.delete(value);
        return `[${body}]`;
    }
    if (valueType === "object") {
        if (seen.has(value)) {
            throw new TypeError("Input contains a circular reference.");
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError("Input contains a non-plain object.");
        }
        const record = value;
        if (Object.getOwnPropertySymbols(record).length > 0) {
            throw new TypeError("Input contains a symbol key.");
        }
        const names = Object.getOwnPropertyNames(record);
        const keys = Object.keys(record).sort();
        if (names.length !== keys.length) {
            throw new TypeError("Input contains a non-enumerable property.");
        }
        seen.add(value);
        const body = keys
            .map((key) => `${JSON.stringify(key)}:${canonical(record[key], depth + 1, seen)}`)
            .join(",");
        seen.delete(value);
        return `{${body}}`;
    }
    throw new TypeError(`Cannot fingerprint type ${valueType}.`);
}
/** Stable SHA-256 of a JSON-like value. Object key order does not change the hash. */
export function fingerprintOf(value) {
    return sha256(canonical(value, 0, new WeakSet()));
}
