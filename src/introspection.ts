import { buildClientSchema, getIntrospectionQuery, lexicographicSortSchema, printSchema, type IntrospectionQuery } from 'graphql';
import type { GqlClient } from './client';

/** Fetches the schema and prints it as sorted SDL, so snapshot diffs show only real changes. */
export async function fetchSortedSdl(client: GqlClient): Promise<string> {
  const res = await client.exec<IntrospectionQuery>(getIntrospectionQuery({ descriptions: false }));
  if (res.errors?.length || !res.data) {
    throw new Error(`Introspection failed at ${client.url}: ${JSON.stringify(res.errors)}`);
  }
  return printSchema(lexicographicSortSchema(buildClientSchema(res.data))) + '\n';
}
