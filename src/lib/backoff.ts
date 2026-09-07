export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Full jitter: delay in [0, cap] around exponential base. */
export function backoffDelay(attempt: number, baseMs = 200, capMs = 8000) {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(Math.random() * (exp + 1));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; retryOn?: (e: unknown) => boolean } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const retryOn =
    opts.retryOn ??
    ((e: unknown) => {
      const status = (e as { code?: number; response?: { status?: number } })?.response?.status;
      return status === 429 || (typeof status === "number" && status >= 500);
    });
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === attempts - 1 || !retryOn(e)) throw e;
      const retryAfter = Number(
        (e as { response?: { headers?: { "retry-after"?: string } } }).response?.headers?.["retry-after"]
      );
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : backoffDelay(i));
    }
  }
  throw last;
}

type Breaker = { failures: number; openUntil: number };

const breakers = new Map<string, Breaker>();

export function circuitGuard(name: string, failureThreshold = 5, openMs = 30_000) {
  const b = breakers.get(name) ?? { failures: 0, openUntil: 0 };
  breakers.set(name, b);
  if (Date.now() < b.openUntil) {
    throw new Error(`${name} circuit open`);
  }
  return {
    ok() {
      b.failures = 0;
    },
    fail() {
      b.failures += 1;
      if (b.failures >= failureThreshold) {
        b.openUntil = Date.now() + openMs;
        b.failures = 0;
      }
    },
  };
}

/** Test-only. */
export function resetCircuits() {
  breakers.clear();
}

type Bucket = { tokens: number; last: number };

const buckets = new Map<string, Bucket>();

export function takeToken(name: string, ratePerSec = 5, burst = 10, now = Date.now()) {
  const b = buckets.get(name) ?? { tokens: burst, last: now };
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(burst, b.tokens + elapsed * ratePerSec);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  buckets.set(name, b);
  return true;
}
