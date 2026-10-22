// Proves the security and authorization suites can fail: runs them against the server with every
// control disabled and expects each control's test to go red. A gate that
// stays green here is vacuous.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MUST_FAIL = [
  'is rejected at validation, before execution',
  'depth hidden behind fragment spreads is still counted',
  'alias amplification beyond the limit is rejected',
  'batched operations are not executed',
  'introspection is disabled',
  '__type lookups are disabled too',
  'internal errors are masked',
  'field suggestions do not leak schema names',
  'input field suggestions do not leak through variables',
  "another user's note is indistinguishable from a nonexistent one",
  'node(id) does not bypass the ownership check',
  "nested traversal only exposes the viewer's notes",
  'aliases in one request are each checked',
  "another user's note cannot be updated",
  "another user's note cannot be deleted",
  "another user's email is refused",
  'email stays protected when reached through a fragment or node(id)',
];

const report = 'test-results/selftest.json';
spawnSync('npx', ['playwright', 'test', 'tests/local/security.spec.ts', 'tests/local/authorization.spec.ts', '--project=local', '--reporter=json', '--retries=0'], {
  shell: true,
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, GQL_UNSAFE: '1', LOCAL_GQL_PORT: '4010', CI: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: report },
});

const failed = new Set();
const walk = (suite) => {
  suite.specs?.forEach((s) => s.tests.some((t) => t.status === 'unexpected') && failed.add(s.title));
  suite.suites?.forEach(walk);
};
JSON.parse(readFileSync(report, 'utf8')).suites.forEach(walk);

const vacuous = MUST_FAIL.filter((title) => ![...failed].some((f) => f.includes(title)));
if (vacuous.length) {
  console.error(`SELFTEST FAILED: these stayed green with hardening off:\n  - ${vacuous.join('\n  - ')}`);
  process.exit(1);
}
console.log(`selftest ok: all ${MUST_FAIL.length} security controls go red when removed`);
