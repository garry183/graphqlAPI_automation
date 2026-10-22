import { expectRequestError } from '../../src/assertions';
import { expect, test } from '../../src/fixtures';
import { LIMITS } from '../../server/server.constants';

/** book -> author -> books -> ... -> id, exactly `depth` fields deep (the leaf counts). */
function nested(depth: number): string {
  const levels = ['book(id: "b1")', 'author', 'books', 'author', 'books', 'author', 'books', 'author', 'books'];
  let q = 'id';
  for (let i = depth - 2; i >= 0; i--) q = `${levels[i]} { ${q} }`;
  return `{ ${q} }`;
}

test.describe('query cost controls', () => {
  test(`depth ${LIMITS.depth} executes`, async ({ local }) => {
    const res = await local.exec(nested(LIMITS.depth));
    expect(res.errors).toBeUndefined();
    expect(res.data).toBeTruthy();
  });

  test(`depth ${LIMITS.depth + 2} is rejected at validation, before execution`, async ({ local }) => {
    expectRequestError(await local.exec(nested(LIMITS.depth + 2)), { code: 'DEPTH_LIMIT_EXCEEDED' });
  });

  test('depth hidden behind fragment spreads is still counted', async ({ local }) => {
    const query = /* GraphQL */ `
      fragment A on Author { books { ...B } }
      fragment B on Book { author { books { author { books { id } } } } }
      { book(id: "b1") { author { ...A } } }
    `;
    expectRequestError(await local.exec(query), { code: 'DEPTH_LIMIT_EXCEEDED' });
  });

  test('alias amplification beyond the limit is rejected', async ({ local }) => {
    const fields = Array.from({ length: LIMITS.aliases + 1 }, (_, i) => `a${i}: book(id: "b1") { id }`).join('\n');
    expectRequestError(await local.exec(`{ ${fields} }`), { code: 'ALIAS_LIMIT_EXCEEDED' });
  });

  test('batched operations are not executed', async ({ local }) => {
    const { status, json } = await local.post([{ query: '{ __typename }' }, { query: '{ __typename }' }]);
    expect(Array.isArray(json), `batch executed: ${JSON.stringify(json)}`).toBe(false);
    expect(status).toBeGreaterThanOrEqual(400);
  });
});

test.describe('schema exposure', () => {
  test('introspection is disabled', async ({ local }) => {
    expectRequestError(await local.exec('{ __schema { types { name } } }'), { message: /introspection/i });
  });

  test('__type lookups are disabled too', async ({ local }) => {
    expectRequestError(await local.exec('{ __type(name: "Book") { fields { name } } }'), { message: /introspection/i });
  });

  test('__typename still works (clients depend on it)', async ({ local }) => {
    const res = await local.exec('{ __typename }');
    expect(res.data).toEqual({ __typename: 'Query' });
  });

  test('field suggestions do not leak schema names', async ({ local }) => {
    const res = await local.exec('{ boo { id } }');
    expectRequestError(res, { message: /Cannot query field "boo"/ });
    expect(JSON.stringify(res.errors)).not.toMatch(/Did you mean|"book"/);
  });

  test('input field suggestions do not leak through variables', async ({ local }) => {
    const res = await local.exec('mutation($i: AddBookInput!) { addBook(input: $i) { id } }', { i: { titel: 'x', authorId: 'a1' } });
    expectRequestError(res, { message: /titel/ });
    expect(JSON.stringify(res.errors)).not.toMatch(/Did you mean|"title"/);
  });
});

test.describe('error handling', () => {
  test('internal errors are masked and leak no infrastructure details', async ({ local }) => {
    const res = await local.exec('{ crash }');
    expect(res.errors?.[0]?.message).toBe('Unexpected error.');
    expect(JSON.stringify(res.body)).not.toMatch(/password|ECONNREFUSED|db\.internal|stack/i);
  });
});

test.describe('transport', () => {
  test('mutations over GET are refused (CSRF)', async ({ request }) => {
    const query = encodeURIComponent('mutation { addBook(input: {title: "csrf", authorId: "a1"}) { id } }');
    const res = await request.get(`http://localhost:${process.env.LOCAL_GQL_PORT ?? 4000}/graphql?query=${query}`, { failOnStatusCode: false });
    expect(res.status()).toBe(405);
  });

  test('non-JSON content type is refused', async ({ request }) => {
    const res = await request.post(`http://localhost:${process.env.LOCAL_GQL_PORT ?? 4000}/graphql`, {
      headers: { 'content-type': 'text/plain' },
      data: '{"query":"{ __typename }"}',
      failOnStatusCode: false,
    });
    expect(res.status(), 'text/plain is a CORS-simple type: accepting it re-opens CSRF').toBeGreaterThanOrEqual(400);
  });
});
