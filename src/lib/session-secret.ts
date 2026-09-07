/**
 * The single session-secret loader. Shared by the Node runtime (src/lib/session.ts)
 * and the Edge middleware, which previously disagreed: the middleware silently fell
 * back to a public literal in every environment, so a known key could forge any
 * session. There is no fallback here, in any environment.
 */
const MIN_LENGTH = 32;

export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be set to at least ${MIN_LENGTH} characters`
    );
  }
  return new TextEncoder().encode(secret);
}
