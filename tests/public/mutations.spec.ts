import { z } from 'zod';
import { expect, test } from '../../src/fixtures';

// GraphQLZero is a JSONPlaceholder wrapper: mutations return plausible
// responses but persist nothing. Tests assert the response contract only.
test.describe('GraphQLZero: CRUD mutations', () => {
  test('createPost echoes the input and assigns an id', async ({ graphqlZero }) => {
    const input = { title: `t-${Date.now()}`, body: 'body' };
    const { createPost } = await graphqlZero.data(
      `mutation ($input: CreatePostInput!) { createPost(input: $input) { id title body } }`,
      { input },
      z.object({ createPost: z.object({ id: z.string(), title: z.string(), body: z.string() }) }),
    );
    expect(createPost).toMatchObject(input);
    expect(Number(createPost.id)).toBeGreaterThan(100);
  });

  test('updatePost applies a partial update', async ({ graphqlZero }) => {
    const { updatePost } = await graphqlZero.data(
      `mutation { updatePost(id: "1", input: { body: "patched" }) { id body } }`,
      undefined,
      z.object({ updatePost: z.object({ id: z.literal('1'), body: z.literal('patched') }) }),
    );
    expect(updatePost.id).toBe('1');
  });

  test('deletePost reports success', async ({ graphqlZero }) => {
    const { deletePost } = await graphqlZero.data(`mutation { deletePost(id: "1") }`, undefined, z.object({ deletePost: z.boolean() }));
    expect(deletePost).toBe(true);
  });

  test('a nonexistent post should resolve to null', async ({ graphqlZero }) => {
    test.fail(true, 'Observed 2026-10-16: returns an object with all-null fields instead of null, violating its own nullable Post type contract.');
    const res = await graphqlZero.exec(`{ post(id: "999999") { id title } }`);
    expect(res.data).toEqual({ post: null });
  });
});
