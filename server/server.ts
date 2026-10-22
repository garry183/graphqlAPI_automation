/**
 * Local target for tests that must not run against third-party APIs:
 * depth/alias abuse, auth on mutations, error masking, GET-mutation CSRF.
 * In-memory data; restarts clean on every Playwright run.
 */
import { createServer } from 'node:http';
import { GraphQLError, NoSchemaIntrospectionCustomRule, type ValidationRule } from 'graphql';
import { createSchema, createYoga, type Plugin } from 'graphql-yoga';
import { LOCAL_PORT } from '../src/endpoints';
import { aliasLimit, depthLimit } from './rules';
import { LIMITS, TEST_TOKEN } from './server.constants';

interface Author { id: string; name: string }
interface Book { id: string; title: string; authorId: string }

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

const schema = createSchema<{ token: string | null }>({
  typeDefs: /* GraphQL */ `
    type Query {
      books(first: Int = 5, after: String): BookConnection!
      book(id: ID!): Book
      author(id: ID!): Author
      crash: String
    }
    type Mutation {
      addBook(input: AddBookInput!): Book!
    }
    input AddBookInput {
      title: String!
      authorId: ID!
    }
    type Author { id: ID! name: String! books: [Book!]! }
    type Book { id: ID! title: String! author: Author! }
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
      // Simulates an internal failure leaking secrets; masking must hide this message.
      crash: () => {
        throw new Error('connect ECONNREFUSED db.internal:5432 password=hunter2');
      },
    },
    Mutation: {
      addBook: (_, { input }: { input: { title: string; authorId: string } }, ctx) => {
        if (ctx.token !== `Bearer ${TEST_TOKEN}`) {
          throw new GraphQLError('Not authenticated', { extensions: { code: 'UNAUTHENTICATED' } });
        }
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
    },
    Book: { author: (b: Book) => authors.find((a) => a.id === b.authorId)! },
    Author: { books: (a: Author) => books.filter((b) => b.authorId === a.id) },
  },
});

const validationRules = (rules: ValidationRule[]): Plugin => ({
  onValidate({ addValidationRule }) {
    rules.forEach(addValidationRule);
  },
});

// GQL_UNSAFE=1 strips every hardening control. Used only by `npm run selftest`
// to prove tests/local/security.spec.ts goes red when the controls are missing.
const hardened = process.env.GQL_UNSAFE !== '1';

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  landingPage: false,
  graphiql: false,
  maskedErrors: hardened,
  batching: !hardened,
  context: ({ request }) => ({ token: request.headers.get('authorization') }),
  plugins: hardened ? [validationRules([NoSchemaIntrospectionCustomRule, depthLimit(LIMITS.depth), aliasLimit(LIMITS.aliases)])] : [],
});

createServer(yoga).listen(LOCAL_PORT, () => {
  console.log(`local graphql listening on http://localhost:${LOCAL_PORT}/graphql${hardened ? '' : ' (UNSAFE: hardening off)'}`);
});
