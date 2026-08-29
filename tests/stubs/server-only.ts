/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * The real module throws on import outside a React Server Component, which is
 * exactly what it is for — importing lib/examine-connect.ts from a client
 * component should be a build error. Vitest runs in plain Node, so it needs the
 * same no-op Next resolves to under the `react-server` condition.
 */
export {};
