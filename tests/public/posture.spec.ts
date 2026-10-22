import { expect, test } from '../../src/fixtures';
import { endpoints } from '../../src/endpoints';

// One request per check: a posture scan, not an attack. Depth and alias
// abuse run only against the local server (tests/local/security.spec.ts).
const publicKeys = ['countries', 'rickAndMorty', 'swapi', 'graphqlZero', 'pokeApi'] as const;

for (const key of publicKeys) {
  const { name, posture } = endpoints[key];

  test.describe(name, () => {
    test(`introspection ${posture.introspection ? 'enabled' : 'disabled'}`, async ({ request }) => {
      const res = await request.post(endpoints[key].url, {
        data: { query: '{ __schema { queryType { name } } }' },
        failOnStatusCode: false,
      });
      const body = await res.json();
      expect(Boolean(body.data?.__schema), JSON.stringify(body)).toBe(posture.introspection);
    });

    test(`batching ${posture.batching ? 'executes' : 'rejected'}`, async ({ request }) => {
      const res = await request.post(endpoints[key].url, {
        data: [{ query: '{ __typename }' }, { query: '{ __typename }' }],
        failOnStatusCode: false,
      });
      const body = await res.json();
      // An executed batch is an amplification surface: N operations per request, one rate-limit hit.
      expect(Array.isArray(body) && body.every((r: { data?: unknown }) => r.data), JSON.stringify(body)).toBe(posture.batching);
    });
  });
}
