/**
 * In-process fixed window. Ceiling is one container; a second task has its
 * own counters. Upgrade path is ALB/WAF rate rules or a shared store if task
 * count grows.
 *
 * Staging defaults favour legitimate concurrent evaluators (often one NAT IP)
 * while still blocking abusive bursts.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): { ok: true } | { ok: false; retryAfterSec: number } {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (existing.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  existing.count += 1;
  return { ok: true };
}

/** Default mutate budget per IP (POST/PUT/PATCH/DELETE), overridable via env. */
export function defaultMutateRateLimit(): { limit: number; windowMs: number } {
  const raw = Number(process.env.MUTATE_RATE_LIMIT_PER_MIN ?? 240);
  const limit = Number.isFinite(raw) && raw >= 30 ? Math.min(2000, Math.trunc(raw)) : 240;
  return { limit, windowMs: 60_000 };
}

/** Test-only. */
export function resetRateLimits() {
  buckets.clear();
}
