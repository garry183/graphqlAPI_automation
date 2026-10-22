import { z } from 'zod';
import { expectFieldError, expectRequestError } from '../../src/assertions';
import { expect, test } from '../../src/fixtures';
import { TEST_TOKEN } from '../../server/server.constants';

const BookPage = z.object({
  books: z.object({
    totalCount: z.number().int(),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    edges: z.array(z.object({ cursor: z.string(), node: z.object({ id: z.string(), title: z.string() }) })),
  }),
});

const PAGE = /* GraphQL */ `
  query Page($first: Int!, $after: String) {
    books(first: $first, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges { cursor node { id title } }
    }
  }
`;

test.describe('cursor pagination', () => {
  test('walking every page returns each seeded book exactly once', async ({ local }) => {
    const ids: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const { books }: z.infer<typeof BookPage> = await local.data(PAGE, { first: 5, after }, BookPage);
      ids.push(...books.edges.map((e) => e.node.id));
      if (!books.pageInfo.hasNextPage) break;
      expect(books.pageInfo.endCursor).toBe(books.edges.at(-1)!.cursor);
      after = books.pageInfo.endCursor;
    }
    expect(new Set(ids).size, 'duplicate ids across pages').toBe(ids.length);
    for (let i = 1; i <= 12; i++) expect(ids).toContain(`b${i}`);
  });

  test('a forged cursor is rejected, not silently treated as page one', async ({ local }) => {
    const res = await local.exec(PAGE, { first: 5, after: 'garbage' });
    expectFieldError(res, ['books'], 'BAD_USER_INPUT');
  });

  for (const first of [0, 51]) {
    test(`page size ${first} is out of bounds`, async ({ local }) => {
      expectFieldError(await local.exec(PAGE, { first }), ['books'], 'BAD_USER_INPUT');
    });
  }
});

test.describe('mutations', () => {
  const ADD = /* GraphQL */ `
    mutation Add($input: AddBookInput!) { addBook(input: $input) { id title author { id } } }
  `;
  const auth = { authorization: `Bearer ${TEST_TOKEN}` };

  test('authenticated addBook persists and is readable', async ({ local }) => {
    const title = `Created ${Date.now()}`;
    const Added = z.object({ addBook: z.object({ id: z.string(), title: z.string(), author: z.object({ id: z.string() }) }) });
    const { addBook } = await local.data(ADD, { input: { title, authorId: 'a2' } }, Added, { headers: auth });
    expect(addBook).toMatchObject({ title, author: { id: 'a2' } });

    const Read = z.object({ book: z.object({ title: z.string() }).nullable() });
    const { book } = await local.data(`query($id: ID!) { book(id: $id) { title } }`, { id: addBook.id }, Read);
    expect(book?.title).toBe(title);
  });

  test('unauthenticated addBook is refused and writes nothing', async ({ local }) => {
    const before = await local.data(PAGE, { first: 1 }, BookPage);
    const res = await local.exec(ADD, { input: { title: 'nope', authorId: 'a1' } });
    expectFieldError(res, ['addBook'], 'UNAUTHENTICATED');
    expect(res.data ?? null).toBeNull();
    const after = await local.data(PAGE, { first: 1 }, BookPage);
    expect(after.books.totalCount).toBeLessThanOrEqual(before.books.totalCount + 1); // tolerate a parallel authenticated add
    const titles = await local.data(PAGE, { first: 50 }, BookPage);
    expect(titles.books.edges.map((e) => e.node.title)).not.toContain('nope');
  });

  test('business validation: empty title and unknown author', async ({ local }) => {
    expectFieldError(await local.exec(ADD, { input: { title: '  ', authorId: 'a1' } }, { headers: auth }), ['addBook'], 'BAD_USER_INPUT');
    expectFieldError(await local.exec(ADD, { input: { title: 'x', authorId: 'zz' } }, { headers: auth }), ['addBook'], 'BAD_USER_INPUT');
  });

  test('schema validation: missing required input field', async ({ local }) => {
    expectRequestError(await local.exec(ADD, { input: { title: 'x' } }, { headers: auth }), { message: /authorId/ });
  });
});
