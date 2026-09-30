/** Generic pagination wrapper. `nextPage` is `null` on the last page. */

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
  nextPage: number | null;
}

/** Chain pages transparently, yielding items one at a time. */
export async function* iterAll<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
  startPage = 1
): AsyncGenerator<T> {
  let pageNumber = startPage;
  for (;;) {
    const page = await fetchPage(pageNumber);
    yield* page.items;
    if (page.nextPage === null) return;
    pageNumber = page.nextPage;
  }
}
