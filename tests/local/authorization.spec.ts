import { z } from 'zod';
import { expectFieldError } from '../../src/assertions';
import { expect, test } from '../../src/fixtures';
import { TOKENS } from '../../server/server.constants';

// Seed (server/server.ts): alice (u1) owns n1, n2, n3; bob (u2) owns n4. n1 and n4 are both on b1.
const as = (who: keyof typeof TOKENS) => ({ headers: { authorization: `Bearer ${TOKENS[who]}` } });

const NOTE = `query($id: ID!) { note(id: $id) { id text } }`;
const Note = z.object({ note: z.object({ id: z.string(), text: z.string() }).nullable() });

test.describe('object-level authorization (BOLA / IDOR)', () => {
  test('owner reads their own note', async ({ local }) => {
    const { note } = await local.data(NOTE, { id: 'n1' }, Note, as('alice'));
    expect(note?.id).toBe('n1');
  });

  test("another user's note is indistinguishable from a nonexistent one", async ({ local }) => {
    const foreign = await local.exec(NOTE, { id: 'n1' }, as('bob'));
    const missing = await local.exec(NOTE, { id: 'n999' }, as('bob'));
    expect(foreign.body).toEqual({ data: { note: null } });
    expect(foreign.body, 'a different response for foreign ids is an existence oracle').toEqual(missing.body);
  });

  test('node(id) does not bypass the ownership check', async ({ local }) => {
    const res = await local.exec(`{ node(id: "n1") { id ... on Note { text } } }`, undefined, as('bob'));
    expect(res.body).toEqual({ data: { node: null } });
  });

  test("nested traversal only exposes the viewer's notes", async ({ local }) => {
    const Nested = z.object({
      book: z.object({ notes: z.array(z.object({ id: z.string() })) }),
      user: z.object({ notes: z.array(z.object({ id: z.string() })) }),
    });
    const res = await local.data(`{ book(id: "b1") { notes { id } } user(id: "u1") { notes { id } } }`, undefined, Nested, as('bob'));
    expect(res.book.notes.map((n) => n.id), 'b1 carries notes from both users').toEqual(['n4']);
    expect(res.user.notes, "alice's notes reached through her public profile").toEqual([]);
  });

  test('aliases in one request are each checked', async ({ local }) => {
    const res = await local.exec(`{ own: note(id: "n4") { id } foreign: note(id: "n1") { id } }`, undefined, as('bob'));
    expect(res.body).toEqual({ data: { own: { id: 'n4' }, foreign: null } });
  });

  test("another user's note cannot be updated", async ({ local }) => {
    const res = await local.exec(`mutation { updateNote(id: "n2", text: "bob was here") { id } }`, undefined, as('bob'));
    expectFieldError(res, ['updateNote'], 'NOT_FOUND');
    const { note } = await local.data(NOTE, { id: 'n2' }, Note, as('alice'));
    expect(note?.text).toBe('alice: update target');
  });

  test("another user's note cannot be deleted", async ({ local }) => {
    const res = await local.exec(`mutation { deleteNote(id: "n3") }`, undefined, as('bob'));
    expectFieldError(res, ['deleteNote'], 'NOT_FOUND');
    const { note } = await local.data(NOTE, { id: 'n3' }, Note, as('alice'));
    expect(note?.id).toBe('n3');
  });

  test('unauthenticated note reads are refused', async ({ local }) => {
    expectFieldError(await local.exec(NOTE, { id: 'n1' }), ['note'], 'UNAUTHENTICATED');
  });
});

test.describe('field-level authorization', () => {
  test('owner sees their own email', async ({ local }) => {
    const Me = z.object({ me: z.object({ email: z.string() }) });
    const { me } = await local.data(`{ me { email } }`, undefined, Me, as('alice'));
    expect(me.email).toBe('alice@example.test');
  });

  test("another user's email is refused while the public profile still resolves", async ({ local }) => {
    const res = await local.exec(`{ user(id: "u1") { name email } }`, undefined, as('bob'));
    expectFieldError(res, ['user', 'email'], 'FORBIDDEN');
    expect(res.data).toEqual({ user: { name: 'Alice', email: null } });
  });

  test('email stays protected when reached through a fragment or node(id)', async ({ local }) => {
    const viaFragment = await local.exec(`fragment F on User { email } { user(id: "u1") { ...F } }`, undefined, as('bob'));
    expectFieldError(viaFragment, ['user', 'email'], 'FORBIDDEN');
    const viaNode = await local.exec(`{ node(id: "u1") { ... on User { email } } }`, undefined, as('bob'));
    expectFieldError(viaNode, ['node', 'email'], 'FORBIDDEN');
    expect(JSON.stringify([viaFragment.body, viaNode.body])).not.toContain('alice@example.test');
  });
});
