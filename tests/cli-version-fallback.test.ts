import { expect, it, vi } from "vitest";

vi.mock("../src/core/version.js", () => ({ SDK_VERSION: "unknown" }));

it("version falls back when the package version can't be read", async () => {
  const { main } = await import("../src/cli.js");
  let stdout = "";
  vi.spyOn(console, "log").mockImplementation((...args) => void (stdout += args.join(" ") + "\n"));
  expect(await main(["version"])).toBe(0);
  expect(stdout).toContain("unknown (not installed as a package)");
});
