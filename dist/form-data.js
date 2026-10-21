/**
 * Pull a string key and string fields out of a Server Action `FormData`.
 * The key field is not part of `input`, so it is not part of the fingerprint.
 * File fields and repeated names throw: this helper does not guess an order for them.
 */
export function inputFromFormData(formData, keyField = "idempotencyKey") {
    if (keyField.trim() === "") {
        throw new TypeError("keyField must be a non-empty string.");
    }
    const input = {};
    let key;
    for (const [name, value] of formData.entries()) {
        if (typeof value !== "string") {
            throw new TypeError(`Field "${name}" is a file. once-action only fingerprints string fields.`);
        }
        if (name === keyField) {
            if (key !== undefined) {
                throw new TypeError(`Field "${keyField}" is repeated.`);
            }
            key = value;
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(input, name)) {
            throw new TypeError(`Field "${name}" is repeated.`);
        }
        input[name] = value;
    }
    if (key === undefined) {
        throw new TypeError(`FormData is missing "${keyField}".`);
    }
    return { key, input };
}
