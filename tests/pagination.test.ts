import { describe, expect, it } from "vitest";
import { iterAll } from "../src/core/pagination.js";
import type { Page } from "../src/index.js";

function page<T>(items: T[], pageNumber: number, nextPage: number | null): Page<T> {
  return { items, page: pageNumber, totalPages: 2, total: items.length * 2, nextPage, previousPage: null, itemsPerPage: null };
}

async function collect<T>(pages: Record<number, Page<T>>, startPage?: number): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterAll((n) => Promise.resolve(pages[n]), startPage)) result.push(item);
  return result;
}

describe("iterAll", () => {
  it("chains pages until nextPage is null", async () => {
    expect(await collect({ 1: page(["a", "b"], 1, 2), 2: page(["c"], 2, null) })).toEqual(["a", "b", "c"]);
  });

  it("stops right away on a single page", async () => {
    expect(await collect({ 1: page(["only"], 1, null) })).toEqual(["only"]);
  });

  it("respects the start page", async () => {
    expect(await collect({ 5: page(["x"], 5, null) }, 5)).toEqual(["x"]);
  });
});
