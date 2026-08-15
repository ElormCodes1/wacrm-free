/**
 * Stand-in for the `server-only` package under vitest.
 *
 * The real package throws when imported from a client build, which is
 * exactly what we want from `next build` and meaningless in a test
 * runner that has no client/server split. Stubbing it keeps server
 * modules testable without weakening the real guard.
 */
export {};
