export function cloneValue(value) {
    if (value === undefined) {
        return value;
    }
    try {
        return structuredClone(value);
    }
    catch {
        throw new TypeError("once-action can only store a structured-cloneable result.");
    }
}
