import { fetchSortedSdl } from '../../src/introspection';
import { expect, test } from '../../src/fixtures';

// A failing snapshot is a schema change on a dependency, the GraphQL analogue
// of a broken contract. Review the diff, then accept with --update-snapshots.
// PokeAPI is excluded: its Hasura schema is several MB of generated types.
for (const key of ['countries', 'rickAndMorty', 'swapi', 'graphqlZero'] as const) {
  test(`${key} schema matches snapshot`, async ({ countries, rickAndMorty, swapi, graphqlZero }) => {
    const client = { countries, rickAndMorty, swapi, graphqlZero }[key];
    expect(await fetchSortedSdl(client)).toMatchSnapshot(`${key}.graphql`);
  });
}
