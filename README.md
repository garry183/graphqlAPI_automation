# GraphQL API Test Framework

Playwright + TypeScript framework for testing GraphQL APIs. It covers functional, contract (schema drift), negative, security and authorization testing. Tests run against five public APIs and a local hardened server.

```bash
npm ci
npm test               # everything (starts the local server automatically)
npm run test:local     # deterministic suite, no network
npm run test:public    # public APIs
npm run selftest       # proves the security and authorization suites go red when controls are removed
npm run schema:update  # accept a reviewed upstream schema change
```

## Layout

| Path | Purpose |
|---|---|
| `src/client.ts` | `GqlClient`: `exec()` returns status/data/errors, `data()` asserts no errors and Zod-validates. Non-JSON responses (CDN/WAF pages) raise `UpstreamUnavailableError`, so an outage is never misread as a GraphQL failure |
| `src/assertions.ts` | `expectRequestError` / `expectFieldError`: assert on `errors[]`, never on HTTP status |
| `src/endpoints.ts` | Target registry plus each server's observed posture (introspection, batching) |
| `src/fixtures.ts` | One Playwright fixture per target |
| `src/introspection.ts` | Introspection to sorted SDL for stable snapshot diffs |
| `server/` | graphql-yoga target with depth limit, alias limit, introspection off, suggestion stripping, error masking, auth on mutations, per-user ownership and field-level checks |
| `scripts/selftest.mjs` | Runs the security and authorization specs with `GQL_UNSAFE=1` and fails if any control's test stays green |

## Coverage

| Area | Target | What's checked |
|---|---|---|
| Queries | Countries, PokeAPI | variables, fragments, aliases, `operationName`, filters, aggregate/list consistency |
| Pagination | Rick and Morty (offset), SWAPI (Relay), local | full walk: no duplicates, count matches total, `endCursor` matches the last edge |
| Mutations | GraphQLZero, local | create/update/delete, auth required, business validation, write really persists (local) |
| Negative | Countries, local | unknown field, missing arg/variable, wrong type, syntax error |
| Schema drift | 4 public APIs | sorted SDL snapshot, run nightly |
| Security | local (abuse), public (posture only) | depth incl. via fragments, alias amplification, batching, introspection, `__type`, field and input-field suggestion leaks, error masking, GET-mutation CSRF, `text/plain` CSRF |
| Authorization | local | BOLA/IDOR: a foreign object reads exactly like a missing one (no existence oracle), across `note(id)`, `node(id)`, nested traversal and aliases; cross-user update/delete refused and verified unchanged; owner-only `email` holds through fragments and `node(id)` |

Abuse tests (deep nesting, alias floods) run **only** against the local server. A single 6-level query to Countries returned a Cloudflare 503 during probing. Public APIs get one request per posture check.

## Findings (observed 2026-10-16)

Each finding is pinned with `test.fail()`. If one starts passing, Playwright reports it, so a fix upstream gets noticed.

- **SWAPI** ignores an invalid `after` cursor and returns page one. A client paging on a bad cursor would loop forever.
- **GraphQLZero** returns `{ id: null, title: null }` for a nonexistent post instead of `null`.
- **Rick and Morty** `info.count` goes `null` past the last page.
- **PokeAPI** executes batched operations: N queries per HTTP request, one rate-limit hit.
- **Countries** returns HTTP 200 for validation errors, while Rick and Morty returns 400. That's why no assertion uses the status code.

## Authorization model (local server)

Two users, `alice` (u1) and `bob` (u2), authenticate with the bearer tokens in `server/server.constants.ts`. Each owns private notes, and one note from each user sits on the same book (b1), so nested reads have something to leak. Every read and write path goes through one `owns()` check, which `GQL_UNSAFE=1` disables so the selftest can prove each authorization test notices.

yoga returns "Did you mean …" hints even with introspection off. They come from query validation and from variable coercion (misspelled input fields), and the `noSuggestions` plugin in `server/rules.ts` strips both.

## CI

`.github/workflows/ci.yml` has two jobs. `local` (typecheck, local suite including authorization, selftest) is the gate. `public` runs on every push and nightly with `continue-on-error`, so a hobby API outage can't block anything.

## Next

- `graphql-codegen` for typed operations generated from the snapshotted SDL (Zod covers runtime validation today)
- Subscriptions over `graphql-ws`
- Persisted queries / APQ
- Query cost analysis (weighted field cost) on top of the depth and alias limits
