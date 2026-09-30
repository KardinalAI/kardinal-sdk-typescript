import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyApiKeyError, KardinalError, MissingApiKeyError } from "../src/index.js";
import { resolveApiKey } from "../src/core/auth.js";

afterEach(() => vi.unstubAllEnvs());

describe("resolveApiKey", () => {
  it("prefers the explicit option over the environment variable", () => {
    vi.stubEnv("KARDINAL_API_KEY", "from-env");
    expect(resolveApiKey("from-arg")).toBe("from-arg");
  });

  it("falls back to the environment variable when the option is omitted", () => {
    vi.stubEnv("KARDINAL_API_KEY", "from-env");
    expect(resolveApiKey(undefined)).toBe("from-env");
  });

  it("throws MissingApiKeyError when neither is set", () => {
    vi.stubEnv("KARDINAL_API_KEY", "");
    try {
      resolveApiKey(undefined);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingApiKeyError);
      expect(e).toBeInstanceOf(KardinalError);
      expect((e as KardinalError).code).toBe("MISSING_API_KEY");
      expect((e as KardinalError).retryable).toBe(false);
    }
  });

  it("throws EmptyApiKeyError for an explicit empty string, instead of falling back", () => {
    // apiKey: "" is a provided-but-empty value, not "nothing was passed":
    // falling back to the environment variable would hide a configuration
    // bug (e.g. an unset shell variable interpolated into an empty string).
    vi.stubEnv("KARDINAL_API_KEY", "from-env");
    try {
      resolveApiKey("");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EmptyApiKeyError);
      expect(e).toBeInstanceOf(KardinalError);
      expect((e as KardinalError).code).toBe("EMPTY_API_KEY");
    }
  });
});
