/**
 * Target registry. `posture` records what each server is *observed* to do
 * (probed 2026-10-16), so tests/public/posture.spec.ts fails when that changes.
 * These are observations, not endorsements: introspection on a production
 * API is itself a finding.
 */
export interface Endpoint {
  name: string;
  url: string;
  posture: {
    introspection: boolean;
    batching: boolean;
  };
}

export const LOCAL_PORT = Number(process.env.LOCAL_GQL_PORT ?? 4000);

export const endpoints = {
  countries: {
    name: 'Countries',
    url: 'https://countries.trevorblades.com/',
    posture: { introspection: true, batching: false },
  },
  rickAndMorty: {
    name: 'Rick and Morty',
    url: 'https://rickandmortyapi.com/graphql',
    posture: { introspection: true, batching: false },
  },
  swapi: {
    name: 'SWAPI',
    url: 'https://swapi-graphql.netlify.app/graphql',
    posture: { introspection: true, batching: false },
  },
  graphqlZero: {
    name: 'GraphQLZero',
    url: 'https://graphqlzero.almansi.me/api',
    posture: { introspection: true, batching: false },
  },
  pokeApi: {
    name: 'PokeAPI',
    url: 'https://beta.pokeapi.co/graphql/v1beta',
    posture: { introspection: true, batching: true },
  },
  local: {
    name: 'Local hardened server',
    url: `http://localhost:${LOCAL_PORT}/graphql`,
    posture: { introspection: false, batching: false },
  },
} satisfies Record<string, Endpoint>;

export type EndpointKey = keyof typeof endpoints;
