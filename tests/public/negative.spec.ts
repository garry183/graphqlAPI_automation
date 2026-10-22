import { expectRequestError } from '../../src/assertions';
import { expect, test } from '../../src/fixtures';
import type { GqlClient } from '../../src/client';

const cases: { name: string; query: string; variables?: Record<string, unknown>; message: RegExp }[] = [
  { name: 'unknown field', query: '{ countryy { code } }', message: /Cannot query field "countryy"/ },
  { name: 'missing required argument', query: '{ country { name } }', message: /argument "code" .* is required/ },
  { name: 'missing required variable', query: 'query ($c: ID!) { country(code: $c) { name } }', message: /\$c.*was not provided/ },
  { name: 'wrong variable type', query: 'query ($c: ID!) { country(code: $c) { name } }', variables: { c: { x: 1 } }, message: /\$c.*invalid value/ },
  { name: 'syntax error', query: '{ country(code: "IN") { name ', message: /./ },
];

test.describe('Countries: request errors live in errors[], not the status code', () => {
  for (const c of cases) {
    test(c.name, async ({ countries }) => {
      expectRequestError(await countries.exec(c.query, c.variables), { message: c.message });
    });
  }
});

test.describe('status codes for the same error differ between servers', () => {
  const unknownField = async (client: GqlClient, root: string) => (await client.exec(`{ ${root}x { id } }`)).status;

  test('validation error: Countries 200, Rick and Morty 400', async ({ countries, rickAndMorty }) => {
    // Documents why expectRequestError never asserts on HTTP status.
    expect(await unknownField(countries, 'country')).toBe(200);
    expect(await unknownField(rickAndMorty, 'character')).toBe(400);
  });
});
