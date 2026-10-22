/**
 * Local target for tests that must not run against third-party APIs:
 * depth/alias abuse, auth on mutations, object- and field-level authorization,
 * error masking, GET-mutation CSRF.
 * In-memory data; restarts clean on every Playwright run.
 */
import { createServer } from 'node:http';
import { GraphQLError, NoSchemaIntrospectionCustomRule, type ValidationRule } from 'graphql';
import { createSchema, createYoga, type Plugin } from 'graphql-yoga';
import { LOCAL_PORT } from '../src/endpoints';
import { aliasLimit, depthLimit, noSuggestions } from './rules';
import { LIMITS, TOKENS } from './server.constants';

// GQL_UNSAFE=1 strips every hardening control. Used only by `npm run selftest`
// to prove the local security and authorization suites go red when the controls are missing.
const hardened = process.env.GQL_UNSAFE !== '1';

interface Author { id: string; name: string }
interface Book { id: string; title: string; authorId: string }
interface User { id: string; name: string; email: string }
interface Note { id: string; text: string; bookId: string; ownerId: string }
interface Ctx { user: User | null }

const users: User[] = [
  { id: 'u1', name: 'Alice', email: 'alice@example.test' },
  { id: 'u2', name: 'Bob', email: 'bob@example.test' },
];
const userByToken = new Map<string, User>([
  [`Bearer ${TOKENS.alice}`, users[0]],
  [`Bearer ${TOKENS.bob}`, users[1]],
]);
// n2 and n3 are reserved for the cross-user update/delete tests so parallel reads stay stable.
const notes: Note[] = [
  { id: 'n1', text: 'alice: private note on b1', bookId: 'b1', ownerId: 'u1' },
  { id: 'n2', text: 'alice: update target', bookId: 'b2', ownerId: 'u1' },
  { id: 'n3', text: 'alice: delete target', bookId: 'b3', ownerId: 'u1' },
  { id: 'n4', text: 'bob: private note on b1', bookId: 'b1', ownerId: 'u2' },
];

const authors: Author[] = [
  { id: 'a1', name: 'Ursula K. Le Guin' },
  { id: 'a2', name: 'Octavia E. Butler' },
];
const books: Book[] = Array.from({ length: 12 }, (_, i) => ({
  id: `b${i + 1}`,
  title: `Book ${i + 1}`,
  authorId: i % 2 ? 'a2' : 'a1',
}));

const cursorOf = (id: string) => Buffer.from(`book:${id}`).toString('base64');
const idOf = (cursor: string) => {
  const raw = Buffer.from(cursor, 'base64').toString();
  if (!raw.startsWith('book:')) {
    throw new GraphQLError('Invalid cursor', { extensions: { code: 'BAD_USER_INPUT' } });
  }
  return raw.slice(5);
};

const requireUser = (ctx: Ctx) => {
  if (!ctx.user) throw new GraphQLError('Not authenticated', { extensions: { code: 'UNAUTHENTICATED' } });
  return ctx.user;
};
// The single ownership check every read and write path goes through. One place
// to get right, and one place GQL_UNSAFE removes for the selftest.
const owns = (ctx: Ctx, ownerId: string) => !hardened || ctx.user?.id === ownerId;
const visibleNote = (ctx: Ctx, id: string) => {
  requireUser(ctx);
  const note = notes.find((n) => n.id === id);
  // A foreign note and a missing note must look identical, or the response is an existence oracle.
  return note && owns(ctx, note.ownerId) ? note : null;
};
const ownedNoteOrThrow = (ctx: Ctx, id: string) => {
  const note = visibleNote(ctx, id);
  if (!note) throw new GraphQLError('Note not found', { extensions: { code: 'NOT_FOUND' } });
  return note;
};

const schema = createSchema<Ctx>({
  typeDefs: /* GraphQL */ `
    interface Node { id: ID! }
    type Query {
      books(first: Int = 5, after: String): BookConnection!
      book(id: ID!): Book
      author(id: ID!): Author
      node(id: ID!): Node
      note(id: ID!): Note
      user(id: ID!): User
      me: User
      crash: String
    }
    type Mutation {
      addBook(input: AddBookInput!): Book!
      updateNote(id: ID!, text: String!): Note!
      deleteNote(id: ID!): Boolean!
    }
    input AddBookInput {
      title: String!
      authorId: ID!
    }
    type Author { id: ID! name: String! books: [Book!]! }
    type Book implements Node { id: ID! title: String! author: Author! notes: [Note!]! }
    "name is public; email is visible to its owner only (nullable so a refusal leaves the rest of the object)."
    type User implements Node { id: ID! name: String! email: String notes: [Note!]! }
    type Note implements Node { id: ID! text: String! book: Book! owner: User! }
    type BookConnection { edges: [BookEdge!]! pageInfo: PageInfo! totalCount: Int! }
    type BookEdge { cursor: String! node: Book! }
    type PageInfo { hasNextPage: Boolean! endCursor: String }
  `,
  resolvers: {
    Query: {
      books: (_, { first, after }: { first: number; after?: string }) => {
        if (first < 1 || first > 50) {
          throw new GraphQLError('first must be between 1 and 50', { extensions: { code: 'BAD_USER_INPUT' } });
        }
        let start = 0;
        if (after) {
          const idx = books.findIndex((b) => b.id === idOf(after));
          if (idx < 0) throw new GraphQLError('Invalid cursor', { extensions: { code: 'BAD_USER_INPUT' } });
          start = idx + 1;
        }
        const page = books.slice(start, start + first);
        return {
          edges: page.map((node) => ({ cursor: cursorOf(node.id), node })),
          pageInfo: { hasNextPage: start + first < books.length, endCursor: page.length ? cursorOf(page.at(-1)!.id) : null },
          totalCount: books.length,
        };
      },
      book: (_, { id }: { id: string }) => books.find((b) => b.id === id) ?? null,
      author: (_, { id }: { id: string }) => authors.find((a) => a.id === id) ?? null,
      node: (_, { id }: { id: string }, ctx) => {
        if (id.startsWith('n')) return visibleNote(ctx, id);
        return books.find((b) => b.id === id) ?? users.find((u) => u.id === id) ?? null;
      },
      note: (_, { id }: { id: string }, ctx) => visibleNote(ctx, id),
      user: (_, { id }: { id: string }) => users.find((u) => u.id === id) ?? null,
      me: (_, __, ctx) => ctx.user,
      // Simulates an internal failure leaking secrets; masking must hide this message.
      crash: () => {
        throw new Error('connect ECONNREFUSED db.internal:5432 password=hunter2');
      },
    },
    Mutation: {
      addBook: (_, { input }: { input: { title: string; authorId: string } }, ctx) => {
        requireUser(ctx);
        if (!input.title.trim()) {
          throw new GraphQLError('title must not be empty', { extensions: { code: 'BAD_USER_INPUT' } });
        }
        if (!authors.some((a) => a.id === input.authorId)) {
          throw new GraphQLError(`Unknown author ${input.authorId}`, { extensions: { code: 'BAD_USER_INPUT' } });
        }
        const book = { id: `b${books.length + 1}`, title: input.title, authorId: input.authorId };
        books.push(book);
        return book;
      },
      updateNote: (_, { id, text }: { id: string; text: string }, ctx) => {
        const note = ownedNoteOrThrow(ctx, id);
        note.text = text;
        return note;
      },
      deleteNote: (_, { id }: { id: string }, ctx) => {
        const note = ownedNoteOrThrow(ctx, id);
        notes.splice(notes.indexOf(note), 1);
        return true;
      },
    },
    Node: {
      __resolveType: (o: Book | User | Note) => ('text' in o ? 'Note' : 'email' in o ? 'User' : 'Book'),
    },
    Book: {
      author: (b: Book) => authors.find((a) => a.id === b.authorId)!,
      notes: (b: Book, _: unknown, ctx: Ctx) => notes.filter((n) => n.bookId === b.id && owns(ctx, n.ownerId)),
    },
    User: {
      email: (u: User, _: unknown, ctx: Ctx) => {
        if (!owns(ctx, u.id)) throw new GraphQLError('Not authorized to read email', { extensions: { code: 'FORBIDDEN' } });
        return u.email;
      },
      notes: (u: User, _: unknown, ctx: Ctx) => notes.filter((n) => n.ownerId === u.id && owns(ctx, n.ownerId)),
    },
    Note: {
      book: (n: Note) => books.find((b) => b.id === n.bookId)!,
      owner: (n: Note) => users.find((u) => u.id === n.ownerId)!,
    },
    Author: { books: (a: Author) => books.filter((b) => b.authorId === a.id) },
  },
});

const validationRules = (rules: ValidationRule[]): Plugin => ({
  onValidate({ addValidationRule }) {
    rules.forEach(addValidationRule);
  },
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  landingPage: false,
  graphiql: false,
  maskedErrors: hardened,
  batching: !hardened,
  context: ({ request }): Ctx => ({ user: userByToken.get(request.headers.get('authorization') ?? '') ?? null }),
  plugins: hardened
    ? [validationRules([NoSchemaIntrospectionCustomRule, depthLimit(LIMITS.depth), aliasLimit(LIMITS.aliases)]), noSuggestions]
    : [],
});

createServer(yoga).listen(LOCAL_PORT, () => {
  console.log(`local graphql listening on http://localhost:${LOCAL_PORT}/graphql${hardened ? '' : ' (UNSAFE: hardening off)'}`);
});
