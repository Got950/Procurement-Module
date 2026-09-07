/**
 * Reject cross-site state changes. SameSite=Lax already blocks most CSRF;
 * this is the application-level check PLAN B-63 asks for.
 */
export function assertSafeOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none" || site === "same-site") return true;
  const origin = req.headers.get("origin");
  if (!origin) {
    // Non-browser clients (curl, workers) have no Origin. Allow when no
    // Sec-Fetch-Site either; browsers always send one of the two on POST.
    return !site || site === "none";
  }
  try {
    const allowed = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (allowed) {
      return new URL(origin).origin === new URL(allowed).origin;
    }
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}
