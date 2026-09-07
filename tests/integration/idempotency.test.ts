import { describe, expect, it, beforeEach } from "vitest";
import { describeDb, resetData, createUser } from "../helpers/db";
import { beginIdempotency, finishIdempotency, hashRequest } from "@/lib/idempotency";

describeDb("idempotency keys", () => {
  beforeEach(async () => {
    await resetData();
  });

  it("replays a completed response", async () => {
    const actorId = await createUser("PROCUREMENT");
    const requestHash = hashRequest({ a: 1 });
    const first = await beginIdempotency({
      key: "k1",
      route: "/api/test",
      actorId,
      requestHash,
    });
    expect(first).toBe("acquired");
    await finishIdempotency({
      key: "k1",
      route: "/api/test",
      status: 200,
      json: { ok: true },
    });
    const second = await beginIdempotency({
      key: "k1",
      route: "/api/test",
      actorId,
      requestHash,
    });
    expect(second).not.toBe("acquired");
    if (second !== "acquired") {
      expect(second.replay?.status).toBe(200);
      expect(second.replay?.json).toEqual({ ok: true });
    }
  });

  it("rejects payload mismatch", async () => {
    const actorId = await createUser("PROCUREMENT");
    await beginIdempotency({
      key: "k2",
      route: "/api/test",
      actorId,
      requestHash: hashRequest({ a: 1 }),
    });
    await finishIdempotency({ key: "k2", route: "/api/test", status: 200, json: { ok: true } });
    await expect(
      beginIdempotency({
        key: "k2",
        route: "/api/test",
        actorId,
        requestHash: hashRequest({ a: 2 }),
      })
    ).rejects.toThrow(/different payload/);
  });
});
