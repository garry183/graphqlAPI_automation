import { z } from 'zod';
import { expect, test } from '../../src/fixtures';

test.describe('Rick and Morty: offset pagination', () => {
  const Page = z.object({
    characters: z.object({
      info: z.object({ count: z.number().nullable(), pages: z.number().nullable(), next: z.number().nullable() }),
      results: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  });
  const Q = `query ($page: Int, $name: String) { characters(page: $page, filter: { name: $name }) { info { count pages next } results { id name } } }`;

  test('walking all pages yields info.count unique matches', async ({ rickAndMorty }) => {
    const first = await rickAndMorty.data(Q, { page: 1, name: 'rick' }, Page);
    const { count, pages } = first.characters.info;
    expect(count).toBeGreaterThan(0);
    expect(pages).toBeLessThanOrEqual(10); // keep the walk polite; revisit if the data set grows

    const ids = first.characters.results.map((r) => r.id);
    let next = first.characters.info.next;
    while (next) {
      const page = await rickAndMorty.data(Q, { page: next, name: 'rick' }, Page);
      ids.push(...page.characters.results.map((r) => r.id));
      next = page.characters.info.next;
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(count);
  });

  test('page past the end returns empty results', async ({ rickAndMorty }) => {
    const res = await rickAndMorty.data(Q, { page: 99, name: 'rick' }, Page);
    expect(res.characters.results).toEqual([]);
    expect(res.characters.info.next).toBeNull();
  });

  test('page past the end should still report the total count', async ({ rickAndMorty }) => {
    test.fail(true, 'Observed 2026-10-16: info.count becomes null past the last page instead of staying at the total.');
    const res = await rickAndMorty.data(Q, { page: 99, name: 'rick' }, Page);
    expect(res.characters.info.count).toBeGreaterThan(0);
  });
});

test.describe('SWAPI: Relay cursor connections', () => {
  const Conn = z.object({
    allFilms: z.object({
      totalCount: z.number(),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      edges: z.array(z.object({ cursor: z.string(), node: z.object({ id: z.string(), title: z.string() }) })),
    }),
  });
  const Q = `query ($after: String) { allFilms(first: 2, after: $after) { totalCount pageInfo { hasNextPage endCursor } edges { cursor node { id title } } } }`;

  test('cursor walk covers totalCount with no duplicates', async ({ swapi }) => {
    const ids: string[] = [];
    let after: string | null = null;
    let total = 0;
    for (let guard = 0; guard < 10; guard++) {
      const { allFilms }: z.infer<typeof Conn> = await swapi.data(Q, { after }, Conn);
      total = allFilms.totalCount;
      ids.push(...allFilms.edges.map((e) => e.node.id));
      expect(allFilms.pageInfo.endCursor).toBe(allFilms.edges.at(-1)?.cursor ?? null);
      if (!allFilms.pageInfo.hasNextPage) break;
      after = allFilms.pageInfo.endCursor;
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(total);
  });

  test('an invalid cursor should be rejected', async ({ swapi }) => {
    test.fail(true, 'Observed 2026-10-16: SWAPI ignores a garbage `after` and silently returns page one. A client would loop forever.');
    const res = await swapi.exec(Q, { after: 'garbage' });
    expect(res.errors).toBeDefined();
  });
});
