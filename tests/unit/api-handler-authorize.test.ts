import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { AuthorizationError } from "@/lib/errors";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({
    sub: "user-1",
    role: "REQUESTER",
    name: "Requester",
    jti: "jti-1",
  })),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: () => ({ ok: true }),
  defaultMutateRateLimit: () => ({ limit: 240, windowMs: 60_000 }),
}));

vi.mock("@/lib/idempotency", () => ({
  beginIdempotency: async () => "acquired",
  finishIdempotency: async () => undefined,
  hashRequest: () => "hash",
}));

describe("BUG-011 withApiHandler authorize before body parse", () => {
  it("returns 403 without schema field details for unauthorized malformed body", async () => {
    const bodySchema = z.object({
      budgetAllocation: z.string(),
      accountNo: z.string(),
      secretSchemaField: z.string(),
    });

    const handler = withApiHandler({
      body: bodySchema,
      authorize: () => {
        throw new AuthorizationError();
      },
    })(async () => NextResponse.json({ ok: true }));

    const res = await handler(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(403);
    const json = (await res.json()) as {
      error?: string;
      errorDetail?: { details?: unknown; code?: string };
    };
    expect(json.errorDetail?.code).toBe("FORBIDDEN");
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("budgetAllocation");
    expect(serialized).not.toContain("secretSchemaField");
    expect(serialized).not.toContain("fieldErrors");
  });
});
