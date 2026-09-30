/**
 * HTTP transport: base URL, bearer auth, timeout, retry-on-network/5xx for
 * GET/PUT/DELETE (see ./retry), and translation of failed responses into
 * the ./errors hierarchy.
 */

import { arch, type } from "node:os";
import { isRetryable, sleep } from "./retry.js";
import { KardinalConnectionError, KardinalError, fromResponse } from "./errors.js";
import type { ApiErrorEntry } from "./errors.js";

export const DEFAULT_BASE_URL = "https://app.kardinal.ai/api/v2";
export const BASE_URL_ENV_VAR = "KARDINAL_BASE_URL";

/** SDK package version, read from package.json at runtime (see ./version). */
import { SDK_VERSION } from "./version.js";

/** `baseUrl` option, then `KARDINAL_BASE_URL`, then
 * `https://app.kardinal.ai/api/v2`. An empty value falls through. */
export function resolveBaseUrl(baseUrl: string | undefined): string {
  return baseUrl || process.env[BASE_URL_ENV_VAR] || DEFAULT_BASE_URL;
}

// Error codes Node's fetch reports (on `error.cause.code`) when the
// connection never opened (DNS, refused, unreachable, TLS handshake):
// nothing was sent, so even a POST is safe to retry. Anything else (reset
// socket, our own timeout abort) may have happened after the request
// reached the server.
const NEVER_SENT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function neverSent(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" && NEVER_SENT_CODES.has(code);
}

function clientHeader(): string {
  return `kardinal-sdk-typescript/${SDK_VERSION}`;
}

/** `User-Agent`: SDK version, Node version, OS and architecture, and the
 * version of undici (Node's built-in `fetch`). Nothing personal. `cli`
 * marks calls made by the `kardinal` command. */
export function userAgent(opts: { cli?: boolean } = {}): string {
  const details = [...(opts.cli ? ["cli"] : []), `Node/${process.version}`, `${type()}/${arch()}`];
  const undici = process.versions.undici ? ` undici/${process.versions.undici}` : "";
  return `${clientHeader()} (${details.join("; ")})${undici}`;
}

export interface TransportOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class Transport {
  readonly baseUrl: string;
  /** @internal overridden by the CLI to add its `cli` marker */
  userAgent = userAgent();
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
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        "X-Kardinal-Client": clientHeader(),
        "User-Agent": this.userAgent,
      };
      if (opts.json !== undefined) headers["Content-Type"] = "application/json";
      let response: Response;
      let text: string;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
          signal: controller.signal,
          // Like the Python SDK: a 3xx is reported as an error, not followed.
          redirect: "manual",
        });
        // Read inside the try, so the timeout also covers the body.
        text = await response.text();
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
          retryable: neverSent(cause) || method.toUpperCase() !== "POST",
        });
      }
      clearTimeout(timer);

      if (response.status < 300) {
        if (response.status === 204) return null;
        if (!text) return null;
        try {
          return JSON.parse(text) as T;
        } catch (cause) {
          throw new KardinalError(
            `Server returned a ${response.status} with a non-JSON body: ${(cause as Error).message}`,
            {
              code: "INVALID_RESPONSE_BODY",
              status: response.status,
              requestId: response.headers.get("X-Request-Id"),
              retryable: false,
            }
          );
        }
      }

      if (attempt < this.maxRetries && isRetryable(method, { status: response.status, networkError: false })) {
        attempt += 1;
        await sleep(attempt);
        continue;
      }
      throw this.errorFor(response, text, method);
    }
  }

  private errorFor(response: Response, text: string, method: string): KardinalError {
    const requestId = response.headers.get("X-Request-Id");
    let errors: ApiErrorEntry[] = [];
    let warnings: ApiErrorEntry[] = [];
    try {
      const body = text ? JSON.parse(text) : null;
      if (body !== null && typeof body === "object" && !Array.isArray(body)) {
        errors = body.errors ?? [];
        warnings = body.warnings ?? [];
      }
    } catch {
      errors = [];
      warnings = [];
    }
    return fromResponse({ status: response.status, requestId, errors, warnings, method });
  }
}
