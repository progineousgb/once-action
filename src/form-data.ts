import type { FormActionInput } from "./types.js";

/**
 * Pull a string key and string fields out of a Server Action `FormData`.
 * The key field is not part of `input`, so it is not part of the fingerprint.
 * File fields and repeated names throw: this helper does not guess an order for them.
 */
export function inputFromFormData(formData: FormData, keyField = "idempotencyKey"): FormActionInput {
  if (keyField.trim() === "") {
    throw new TypeError("keyField must be a non-empty string.");
  }

  const input: Record<string, string> = {};
  let key: string | undefined;

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
    // defineProperty, not assignment: a field named "__proto__" must become an
    // own key instead of hitting the Object.prototype setter and vanishing.
    Object.defineProperty(input, name, { value, enumerable: true, writable: true, configurable: true });
  }

  if (key === undefined) {
    throw new TypeError(`FormData is missing "${keyField}".`);
  }

  return { key, input };
}
