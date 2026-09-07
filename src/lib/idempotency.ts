import { createHash } from "crypto";
import { query } from "@/lib/db";
import { ConflictError } from "@/lib/errors";

export function hashRequest(parts: unknown) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

type Stored = { actor_id: string | null; request_hash: string; status: number; response_json: unknown };

async function load(key: string, route: string): Promise<Stored | null> {
  const r = await query<Stored>(
    `SELECT actor_id, request_hash, status, response_json
       FROM idempotency_keys WHERE key = $1 AND route = $2`,
    [key, route]
  );
  return r.rows[0] ?? null;
}

export async function beginIdempotency(params: {
  key: string;
  route: string;
  actorId: string;
  requestHash: string;
}): Promise<{ replay?: { status: number; json: unknown } } | "acquired"> {
  const inserted = await query(
    `INSERT INTO idempotency_keys (key, route, actor_id, request_hash, status, response_json)
     VALUES ($1, $2, $3, $4, 0, '{}'::jsonb)
     ON CONFLICT (key, route) DO NOTHING
     RETURNING key`,
    [params.key, params.route, params.actorId, params.requestHash]
  );
  if (inserted.rows[0]) return "acquired";

  for (let i = 0; i < 40; i++) {
    const row = await load(params.key, params.route);
    if (!row) return "acquired";
    if (row.actor_id && row.actor_id !== params.actorId) {
      throw new ConflictError("Idempotency-Key belongs to another actor");
    }
    if (row.request_hash !== params.requestHash) {
      throw new ConflictError("Idempotency-Key reused with a different payload");
    }
    if (row.status !== 0) {
      return { replay: { status: row.status, json: row.response_json } };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new ConflictError("Idempotency-Key is still in flight");
}

export async function finishIdempotency(params: {
  key: string;
  route: string;
  status: number;
  json: unknown;
}) {
  if (params.status >= 500) {
    await query(`DELETE FROM idempotency_keys WHERE key = $1 AND route = $2 AND status = 0`, [
      params.key,
      params.route,
    ]);
    return;
  }
  await query(
    `UPDATE idempotency_keys
        SET status = $3, response_json = $4::jsonb
      WHERE key = $1 AND route = $2`,
    [params.key, params.route, params.status, JSON.stringify(params.json ?? {})]
  );
}
