import { expect } from '@playwright/test';
import type { GqlResponse } from './client';

/**
 * A GraphQL request error. Servers disagree on HTTP status for the same error
 * (Countries returns 200 for validation failures, Rick and Morty 400), so the
 * contract is the `errors` array and absent `data`, never the status code.
 */
export function expectRequestError(res: GqlResponse<unknown>, match: { message?: RegExp; code?: string }) {
  expect(res.errors, `expected errors, got ${JSON.stringify(res.body)}`).toBeDefined();
  expect(res.errors!.length).toBeGreaterThan(0);
  expect(res.data ?? null, 'request errors must not return data').toBeNull();
  if (match.message) {
    expect(res.errors!.map((e) => e.message).join('\n')).toMatch(match.message);
  }
  if (match.code) {
    expect(res.errors!.map((e) => e.extensions?.code)).toContain(match.code);
  }
}

/** A field (execution) error: partial data allowed, error carries a path. */
export function expectFieldError(res: GqlResponse<unknown>, path: (string | number)[], code?: string) {
  const err = res.errors?.find((e) => JSON.stringify(e.path) === JSON.stringify(path));
  expect(err, `no error at path ${path.join('.')}: ${JSON.stringify(res.body)}`).toBeDefined();
  if (code) expect(err!.extensions?.code).toBe(code);
}
