import { afterEach, expect, it, vi } from "vitest";
import { loadCommander } from "../src/cli.js";

afterEach(() => vi.restoreAllMocks());

/** The error Node.js throws when an ESM import names a package that isn't installed. */
function moduleNotFound(name: string): Error {
  return Object.assign(new Error(`Cannot find package '${name}' imported from /app/node_modules/@kardinal-ai/sdk/dist/cli.js`), {
    code: "ERR_MODULE_NOT_FOUND",
  });
}

it("says how to install commander when the kardinal command runs without it", async () => {
  let stderr = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => ((stderr += String(chunk)), true));
  const exit = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    throw new Error(`exit ${code}`);
  }) as never);

  await expect(loadCommander(() => Promise.reject(moduleNotFound("commander")))).rejects.toThrow("exit 2");
  expect(exit).toHaveBeenCalledWith(2);
  expect(stderr).toContain("npm install @kardinal-ai/sdk commander");
  expect(stderr).not.toContain("Cannot find package");
});

it("lets any other import failure through unchanged", async () => {
  const other = moduleNotFound("zod");
  await expect(loadCommander(() => Promise.reject(other))).rejects.toBe(other);
});
