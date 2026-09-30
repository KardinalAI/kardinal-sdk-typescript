/**
 * The installed `kardinal` version, read from package.json at runtime
 * rather than hardcoded — avoids a second source of truth that can drift
 * out of sync (the exact bug the Python sibling SDK originally shipped
 * with, then fixed: `kardinal version` was a separate literal string from
 * `pyproject.toml`'s own version).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function readSdkVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/core/version.js -> ../../package.json (repo/package root)
    const pkgPath = join(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const SDK_VERSION = readSdkVersion();
