import type { FormActionInput } from "./types.js";
/**
 * Pull a string key and string fields out of a Server Action `FormData`.
 * The key field is not part of `input`, so it is not part of the fingerprint.
 * File fields and repeated names throw: this helper does not guess an order for them.
 */
export declare function inputFromFormData(formData: FormData, keyField?: string): FormActionInput;
