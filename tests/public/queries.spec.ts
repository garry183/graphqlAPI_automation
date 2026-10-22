import { z } from 'zod';
import { expect, test } from '../../src/fixtures';

test.describe('Countries: variables, fragments, operation selection', () => {
  const Country = z.object({
    code: z.string().length(2),
    name: z.string(),
    capital: z.string().nullable(),
    currency: z.string().nullable(),
    continent: z.object({ code: z.string(), name: z.string() }),
    languages: z.array(z.object({ code: z.string(), name: z.string() })),
  });

  test('country by code via variables, validated by schema', async ({ countries }) => {
    const { country } = await countries.data(
      `query ($code: ID!) { country(code: $code) { code name capital currency continent { code name } languages { code name } } }`,
      { code: 'IN' },
      z.object({ country: Country }),
    );
    expect(country).toMatchObject({ code: 'IN', name: 'India', capital: 'New Delhi', continent: { code: 'AS' } });
    expect(country.languages.map((l) => l.code)).toContain('hi');
  });

  test('unknown code returns null, not an error', async ({ countries }) => {
    const res = await countries.exec(`{ country(code: "ZZ") { code } }`);
    expect(res.errors).toBeUndefined();
    expect(res.data).toEqual({ country: null });
  });

  test('filter: every returned country belongs to the requested continent', async ({ countries }) => {
    const { countries: list } = await countries.data(
      `query ($c: String!) { countries(filter: { continent: { eq: $c } }) { code continent { code } } }`,
      { c: 'EU' },
      z.object({ countries: z.array(z.object({ code: z.string(), continent: z.object({ code: z.string() }) })) }),
    );
    expect(list.length).toBeGreaterThan(40);
    expect(list.every((c) => c.continent.code === 'EU')).toBe(true);
  });

  test('fragments and aliases resolve independently', async ({ countries }) => {
    const { india, japan } = await countries.data(
      `fragment Core on Country { code name }
       { india: country(code: "IN") { ...Core } japan: country(code: "JP") { ...Core } }`,
      undefined,
      z.object({ india: z.object({ code: z.string(), name: z.string() }), japan: z.object({ code: z.string(), name: z.string() }) }),
    );
    expect([india.name, japan.name]).toEqual(['India', 'Japan']);
  });

  test('operationName picks one operation from a multi-operation document', async ({ countries }) => {
    const doc = `query A { country(code: "IN") { name } } query B { country(code: "FR") { name } }`;
    const B = z.object({ country: z.object({ name: z.string() }) });
    expect((await countries.data(doc, undefined, B, { operationName: 'B' })).country.name).toBe('France');
  });
});

test.describe('PokeAPI (Hasura): where filters and aggregates', () => {
  test('aggregate count agrees with the filtered list', async ({ pokeApi }) => {
    const res = await pokeApi.data(
      `query ($p: String!) {
         list: pokemon_v2_pokemon(where: { name: { _ilike: $p } }) { id name }
         agg: pokemon_v2_pokemon_aggregate(where: { name: { _ilike: $p } }) { aggregate { count } }
       }`,
      { p: 'pika%' },
      z.object({
        list: z.array(z.object({ id: z.number(), name: z.string() })),
        agg: z.object({ aggregate: z.object({ count: z.number() }) }),
      }),
    );
    expect(res.list.length).toBeGreaterThan(0);
    expect(res.agg.aggregate.count).toBe(res.list.length);
    expect(res.list.every((p) => p.name.startsWith('pika'))).toBe(true);
  });
});
