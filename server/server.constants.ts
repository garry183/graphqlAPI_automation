// Shared with tests. Kept apart from server.ts because importing that file starts the server.
export const LIMITS = { depth: 5, aliases: 15 } as const;
export const TOKENS = { alice: 'alice-token', bob: 'bob-token' } as const;
export const TEST_TOKEN = TOKENS.alice;
