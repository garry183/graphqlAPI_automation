import { test as base } from '@playwright/test';
import { GqlClient } from './client';
import { endpoints, type EndpointKey } from './endpoints';

type Clients = Record<EndpointKey, GqlClient>;

const client = (key: EndpointKey) =>
  async ({ request }: { request: import('@playwright/test').APIRequestContext }, use: (c: GqlClient) => Promise<void>) =>
    use(new GqlClient(request, endpoints[key].url));

export const test = base.extend<Clients>({
  countries: client('countries'),
  rickAndMorty: client('rickAndMorty'),
  swapi: client('swapi'),
  graphqlZero: client('graphqlZero'),
  pokeApi: client('pokeApi'),
  local: client('local'),
});

export { expect } from '@playwright/test';
