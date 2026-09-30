/**
 * HTTP transport: base URL, bearer auth, timeout, retry-on-network/5xx for
 * GET/PUT/DELETE (see ./retry), and translation of failed responses into
 * the ./errors hierarchy.
 */

import { isRetryable, sleep } from "./retry.js";
import { KardinalConnectionError, KardinalError, fromResponse } from "./errors.js";

export const DEFAULT_BASE_URL = "https://app.kardinal.ai/api/v2";
export const BASE_URL_ENV_VAR = "KARDINAL_BASE_URL";

/**
 * SDK package version, read from package.json at build time via a
 * generated constant rather than hardcoded here — see scripts/version.ts.
 * Kept as a plain string import so this file has no filesystem dependency.
 */
import { SDK_VERSION } from "./version.js";

/**
 * `base_url` argument, then `KARDINAL_BASE_URL`, then production.
 *
 * Kardinal has more than one environment, each with its own signing keys:
 * a token only authenticates against the host matching whatever console
 * issued it. Without this, the only way to target anything but production
 * is to pass `baseUrl` in code.
 */
export function resolveBaseUrl(baseUrl: string | undefined): string {
  return baseUrl || process.env[BASE_URL_ENV_VAR] || DEFAULT_BASE_URL;
}

function clientHeader(): string {
  return `kardinal-sdk-typescript/${SDK_VERSION}`;
}

export interface TransportOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class Transport {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: TransportOptions) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    opts: { json?: unknown; params?: Record<string, string | number | undefined> } = {}
  ): Promise<T | null> {
    const url = new URL(this.baseUrl.replace(/\/$/, "") + path);
    if (opts.params) {
      for (const [key, value] of Object.entries(opts.params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "X-Kardinal-Client": clientHeader(),
            "User-Agent": `${clientHeader()} (Node/${process.version})`,
          },
          body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
          signal: controller.signal,
        });
      } catch (cause) {
        clearTimeout(timer);
        if (attempt < this.maxRetries && isRetryable(method, { status: null, networkError: true })) {
          attempt += 1;
          await sleep(attempt);
          continue;
        }
        throw new KardinalConnectionError(cause instanceof Error ? cause.message : String(cause), {
          code: "CONNECTION_ERROR",
          status: 0,
          requestId: null,
          retryable: false,
        });
      }
      clearTimeout(timer);

      if (response.status < 300) {
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? (JSON.parse(text) as T) : null;
      }

      if (attempt < this.maxRetries && isRetryable(method, { status: response.status, networkError: false })) {
        attempt += 1;
        await sleep(attempt);
        continue;
      }
      throw await this.errorFor(response);
    }
  }

  private async errorFor(response: Response): Promise<KardinalError> {
    const requestId = response.headers.get("X-Request-Id");
    let errors: Array<{ code: string; message: string }> = [];
    try {
      const text = await response.text();
      if (text) errors = JSON.parse(text).errors ?? [];
    } catch {
      errors = [];
    }
    return fromResponse({ status: response.status, requestId, errors });
  }
}
