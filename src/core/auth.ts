/**
 * API key resolution. Environment variable only — no `--api-key` CLI flag,
 * it would land in shell history and the process list.
 */

import { KardinalError } from "./errors.js";

export const API_KEY_ENV_VAR = "KARDINAL_API_KEY";

export class MissingApiKeyError extends KardinalError {
  constructor() {
    super(
      `No API key provided. Pass apiKey in the Kardinal() options, or set the ${API_KEY_ENV_VAR} environment variable.`,
      { code: "MISSING_API_KEY", status: 0, requestId: null, retryable: false }
    );
  }
}

/**
 * `apiKey: ""` was passed explicitly — distinct from not passing one at
 * all: falling back to the environment variable here would silently hide a
 * configuration bug (e.g. an unset environment variable interpolated as "").
 */
export class EmptyApiKeyError extends KardinalError {
  constructor() {
    super(
      `apiKey was passed as an empty string. Pass a real key, or omit the option entirely to read it from ${API_KEY_ENV_VAR}.`,
      { code: "EMPTY_API_KEY", status: 0, requestId: null, retryable: false }
    );
  }
}

export function resolveApiKey(apiKey: string | undefined): string {
  if (apiKey !== undefined) {
    if (apiKey === "") throw new EmptyApiKeyError();
    return apiKey;
  }
  const fromEnv = process.env[API_KEY_ENV_VAR];
  if (fromEnv) return fromEnv;
  throw new MissingApiKeyError();
}
