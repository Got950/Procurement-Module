import { describe, expect, it } from "vitest";
import { consumeRateLimit, defaultMutateRateLimit, resetRateLimits } from "@/lib/rate-limit";
import { resetConcurrencyGates, withConcurrencyGate } from "@/lib/concurrency";
import { RateLimitError } from "@/lib/errors";

describe("rate limit", () => {
  it("allows up to the limit then rejects until the window resets", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    expect(consumeRateLimit("k", 2, 1000, t0).ok).toBe(true);
    expect(consumeRateLimit("k", 2, 1000, t0 + 1).ok).toBe(true);
    const blocked = consumeRateLimit("k", 2, 1000, t0 + 2);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(consumeRateLimit("k", 2, 1000, t0 + 1000).ok).toBe(true);
  });

  it("default mutate limit is staging-friendly (>= 60/min)", () => {
    const prev = process.env.MUTATE_RATE_LIMIT_PER_MIN;
    delete process.env.MUTATE_RATE_LIMIT_PER_MIN;
    expect(defaultMutateRateLimit().limit).toBeGreaterThanOrEqual(60);
    if (prev === undefined) delete process.env.MUTATE_RATE_LIMIT_PER_MIN;
    else process.env.MUTATE_RATE_LIMIT_PER_MIN = prev;
  });
});

describe("concurrency gate", () => {
  it("rejects when the gate is saturated", async () => {
    resetConcurrencyGates();
    process.env.TEST_GATE_MAX = "1";
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const first = withConcurrencyGate("test-gate", "TEST_GATE_MAX", 1, async () => {
      await hold;
      return "ok";
    });
    await new Promise((r) => setTimeout(r, 10));
    await expect(
      withConcurrencyGate("test-gate", "TEST_GATE_MAX", 1, async () => "nope")
    ).rejects.toBeInstanceOf(RateLimitError);
    release();
    await expect(first).resolves.toBe("ok");
    delete process.env.TEST_GATE_MAX;
  });
});
