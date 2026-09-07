/* eslint-disable @typescript-eslint/no-explicit-any */
import { AsyncLocalStorage } from "async_hooks";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalForPg = globalThis as unknown as {
  pgPool?: Pool;
  pgPoolDatabaseUrl?: string;
};

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (globalForPg.pgPool && globalForPg.pgPoolDatabaseUrl === url) {
    return globalForPg.pgPool;
  }
  if (globalForPg.pgPool) {
    void globalForPg.pgPool.end();
  }
  // Bounded so N application tasks cannot exceed the RDS connection limit, and
  // so a stuck query or an unreachable database fails fast instead of hanging
  // the request (and the readiness probe) indefinitely.
  const pool = new Pool({
    connectionString: url,
    // Web + worker each open a pool. Keep (2 × max) well under Postgres
    // max_connections on a 2 vCPU / ~4 GiB staging host (default ~100).
    max: Number(process.env.DATABASE_POOL_MAX ?? 8),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
  });
  // An idle client erroring (network drop, RDS failover) is emitted here; without
  // a listener pg turns it into an uncaught exception and kills the process.
  pool.on("error", (error) => {
    console.error("postgres idle client error", error.message);
  });
  globalForPg.pgPool = pool;
  globalForPg.pgPoolDatabaseUrl = url;
  return pool;
}

const CAMEL = /_([a-z])/g;
const SNAKE = /[A-Z]/g;

function toCamel<T extends QueryResultRow>(row: T): any {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(CAMEL, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}

function toSnake(key: string) {
  return key.replace(SNAKE, (m) => `_${m.toLowerCase()}`);
}

function sqlIdent(key: string) {
  const snake = toSnake(key);
  if (!/^[a-z][a-z0-9_]*$/.test(snake)) {
    throw new Error(`Invalid SQL identifier: ${key}`);
  }
  return snake;
}

function mapRows<T extends QueryResultRow>(rows: T[]): any[] {
  return rows.map((r) => toCamel(r));
}

/** Prisma-style `select: { field: true }` → SQL column list (never interpolates user keys raw). */
function selectSql(select?: Record<string, unknown>): string {
  if (!select || typeof select !== "object") return "*";
  const cols = Object.entries(select)
    .filter(([, v]) => v === true)
    .map(([k]) => sqlIdent(k));
  if (!cols.length) return "*";
  return cols.join(", ");
}

function projectRow(
  row: Record<string, unknown>,
  select?: Record<string, unknown>
): Record<string, unknown> {
  if (!select || typeof select !== "object") return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) {
    if (v === true) out[k] = row[k];
  }
  return out;
}

/**
 * Users may only expose passwordHash when explicitly selected (admin hasPassword checks).
 * Relation loads and default finds never return credential material.
 */
function stripUserSecrets(
  row: Record<string, unknown> | null,
  select?: Record<string, unknown>
): Record<string, unknown> | null {
  if (!row) return row;
  if (select && select.passwordHash === true) return row;
  if (!("passwordHash" in row)) return row;
  const { passwordHash: _removed, ...rest } = row;
  return rest;
}

function applySelectAndSecrets(
  table: string,
  rows: Record<string, unknown>[],
  select?: Record<string, unknown>
) {
  let out = select ? rows.map((r) => projectRow(r, select)) : rows;
  if (table === "users") {
    out = out.map((r) => stripUserSecrets(r, select) as Record<string, unknown>);
  }
  return out;
}

/** Safe default when a user relation is included without an explicit select. */
export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  department: true,
  username: true,
} as const;

function userArgsFromInclude(spec: unknown, where: Record<string, unknown>) {
  if (spec && typeof spec === "object" && (spec as { select?: unknown }).select) {
    return { where, select: (spec as { select: Record<string, unknown> }).select };
  }
  return { where, select: { ...PUBLIC_USER_SELECT } };
}

/**
 * The transaction client for the current async context. Every accessor below
 * goes through `query`, so opening a transaction makes the whole call tree
 * transactional without threading a client through 60 shim methods.
 */
const transactionClient = new AsyncLocalStorage<PoolClient>();

/**
 * One connection can only run one statement at a time, and several accessors
 * fan out with `Promise.all`. Chaining per client keeps those call sites working
 * inside a transaction instead of overlapping queries on one connection.
 */
const transactionQueue = new WeakMap<PoolClient, Promise<unknown>>();

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
) {
  const tx = transactionClient.getStore();
  if (!tx) return getPool().query<T>(text, values);

  const previous = transactionQueue.get(tx) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => tx.query<T>(text, values));
  transactionQueue.set(tx, next);
  return next;
}

/**
 * Runs `fn` in one transaction. A nested call joins the outer transaction
 * instead of opening a second one, so a use case cannot half-commit itself.
 */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const existing = transactionClient.getStore();
  if (existing) return fn(existing);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await transactionClient.run(client, () => fn(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // Never let a failed rollback mask the error that caused it.
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function inTransaction() {
  return transactionClient.getStore() !== undefined;
}

/**
 * Serialises concurrent work on one case: every use case takes this lock first,
 * in this order, so child-table writes cannot interleave and deadlock.
 * Returns false when the indent does not exist.
 */
export async function lockIndent(indentId: string): Promise<boolean> {
  if (!inTransaction()) {
    throw new Error("lockIndent must be called inside withTransaction");
  }
  const result = await query("SELECT id FROM indents WHERE id = $1 FOR UPDATE", [indentId]);
  return (result.rowCount ?? 0) > 0;
}

const COMPARE_OPS = ["lte", "gte", "lt", "gt"] as const;
const SQL_COMPARE: Record<(typeof COMPARE_OPS)[number], string> = {
  lte: "<=",
  gte: ">=",
  lt: "<",
  gt: ">",
};

function whereBuilder(where?: Record<string, unknown>, values: unknown[] = []) {
  if (!where || Object.keys(where).length === 0) return "TRUE";
  const clauses: string[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR" && Array.isArray(value)) {
      const parts = value
        .filter((v) => v && typeof v === "object")
        .map((branch) => `(${whereBuilder(branch as Record<string, unknown>, values)})`);
      if (parts.length) clauses.push(`(${parts.join(" OR ")})`);
      continue;
    }
    const col = sqlIdent(key);
    if (value === null) {
      clauses.push(`${col} IS NULL`);
      continue;
    }
    let compared = false;
    if (value && typeof value === "object") {
      for (const op of COMPARE_OPS) {
        if (op in (value as Record<string, unknown>)) {
          values.push((value as Record<string, unknown>)[op]);
          clauses.push(`${col} ${SQL_COMPARE[op]} $${values.length}`);
          compared = true;
          break;
        }
      }
    }
    if (compared) continue;
    if (value && typeof value === "object" && "in" in (value as Record<string, unknown>)) {
      const arr = (value as { in: unknown[] }).in;
      if (!arr.length) {
        clauses.push("FALSE");
      } else {
        const refs = arr.map((v) => {
          values.push(v);
          return `$${values.length}`;
        });
        clauses.push(`${col} IN (${refs.join(", ")})`);
      }
      continue;
    }
    if (value && typeof value === "object" && "notIn" in (value as Record<string, unknown>)) {
      const arr = (value as { notIn: unknown[] }).notIn;
      if (!arr.length) continue;
      const refs = arr.map((v) => {
        values.push(v);
        return `$${values.length}`;
      });
      clauses.push(`${col} NOT IN (${refs.join(", ")})`);
      continue;
    }
    if (value && typeof value === "object" && "equals" in (value as Record<string, unknown>)) {
      values.push((value as { equals: unknown }).equals);
      clauses.push(`${col} = $${values.length}`);
      continue;
    }
    if (value && typeof value === "object" && "contains" in (value as Record<string, unknown>)) {
      const needle = String((value as { contains: unknown }).contains ?? "");
      const mode = String((value as { mode?: unknown }).mode ?? "").toLowerCase();
      values.push(`%${needle}%`);
      if (mode === "insensitive") {
        clauses.push(`${col} ILIKE $${values.length}`);
      } else {
        clauses.push(`${col} LIKE $${values.length}`);
      }
      continue;
    }
    values.push(value);
    clauses.push(`${col} = $${values.length}`);
  }
  return clauses.join(" AND ");
}

async function selectMany(table: string, args: Record<string, unknown> = {}) {
  const values: unknown[] = [];
  const where = whereBuilder(args.where as Record<string, unknown> | undefined, values);
  const select = args.select as Record<string, unknown> | undefined;
  const orderByArg = args.orderBy as
    | Record<string, "asc" | "desc">
    | Array<Record<string, "asc" | "desc">>
    | undefined;
  const orderItems = Array.isArray(orderByArg) ? orderByArg : orderByArg ? [orderByArg] : [];
  const orderSql = orderItems.length
    ? ` ORDER BY ${orderItems
        .flatMap((o) =>
          Object.entries(o).map(([k, d]) => {
            const dir = String(d).toUpperCase() === "DESC" ? "DESC" : "ASC";
            return `${sqlIdent(k)} ${dir}`;
          })
        )
        .join(", ")}`
    : "";
  const takeRaw = args.take as number | undefined;
  const take =
    takeRaw == null || !Number.isFinite(Number(takeRaw))
      ? null
      : Math.min(5000, Math.max(0, Math.trunc(Number(takeRaw))));
  const skipRaw = args.skip as number | undefined;
  const skip =
    skipRaw == null || !Number.isFinite(Number(skipRaw))
      ? null
      : Math.max(0, Math.trunc(Number(skipRaw)));
  let limitSql = "";
  if (take != null) {
    values.push(take);
    limitSql += ` LIMIT $${values.length}`;
  }
  if (skip != null && skip > 0) {
    values.push(skip);
    limitSql += ` OFFSET $${values.length}`;
  }
  const cols = selectSql(select);
  const result = await query(
    `SELECT ${cols} FROM ${table} WHERE ${where}${orderSql}${limitSql}`,
    values
  );
  return applySelectAndSecrets(table, mapRows(result.rows), select);
}

async function selectFirst(table: string, args: Record<string, unknown> = {}) {
  const rows = await selectMany(table, { ...args, take: 1 });
  return rows[0] ?? null;
}

async function selectUnique(table: string, where: Record<string, unknown>, select?: Record<string, unknown>) {
  return selectFirst(table, select ? { where, select } : { where });
}

async function createRow(table: string, data: Record<string, unknown>) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => sqlIdent(k));
  const values = entries.map(([, v]) => v);
  const refs = values.map((_, i) => `$${i + 1}`);
  const result = await query(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${refs.join(", ")}) RETURNING *`,
    values
  );
  const row = toCamel(result.rows[0]);
  if (table === "users") return stripUserSecrets(row, undefined);
  return row;
}

async function updateRow(
  table: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>
) {
  const values: unknown[] = [];
  const sets: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    values.push(v);
    sets.push(`${sqlIdent(k)} = $${values.length}`);
  }
  const whereSql = whereBuilder(where, values);
  const result = await query(
    `UPDATE ${table} SET ${sets.join(", ")} WHERE ${whereSql} RETURNING *`,
    values
  );
  // Zero rows means the guard in `where` did not hold (or the row is gone).
  // Callers decide what that means; previously this crashed on undefined.
  if (!result.rows[0]) return null;
  const row = toCamel(result.rows[0]);
  if (table === "users") return stripUserSecrets(row, undefined);
  return row;
}

async function upsertRow(
  table: string,
  uniqueKey: string,
  uniqueValue: unknown,
  create: Record<string, unknown>,
  update: Record<string, unknown>
) {
  const existing = await selectFirst(table, { where: { [uniqueKey]: uniqueValue } });
  if (existing) {
    return updateRow(table, { [uniqueKey]: uniqueValue }, update);
  }
  return createRow(table, create);
}

async function countRows(table: string, where?: Record<string, unknown>) {
  const values: unknown[] = [];
  const whereSql = whereBuilder(where, values);
  const result = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM ${table} WHERE ${whereSql}`, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function createManyRows(table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return { count: 0 };
  const keys = Object.keys(rows[0]).filter((k) => rows[0][k] !== undefined);
  const uniform = rows.every((row) => keys.every((k) => k in row && row[k] !== undefined));
  if (!uniform) {
    for (const row of rows) await createRow(table, row);
    return { count: rows.length };
  }
  const cols = keys.map(sqlIdent);
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const refs = keys.map((k) => {
      values.push(row[k]);
      return `$${values.length}`;
    });
    return `(${refs.join(", ")})`;
  });
  await query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${tuples.join(", ")}`, values);
  return { count: rows.length };
}

async function updateManyRows(
  table: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>
) {
  const values: unknown[] = [];
  const sets: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    values.push(v);
    sets.push(`${sqlIdent(k)} = $${values.length}`);
  }
  const whereSql = whereBuilder(where, values);
  const result = await query(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${whereSql}`, values);
  return { count: result.rowCount ?? 0 };
}

async function deleteManyRows(table: string, where?: Record<string, unknown>) {
  const values: unknown[] = [];
  const whereSql = whereBuilder(where, values);
  const result = await query(`DELETE FROM ${table} WHERE ${whereSql}`, values);
  return { count: result.rowCount ?? 0 };
}

function relationQueryArgs(spec: unknown, fallback: Record<string, unknown>) {
  if (spec === true || spec == null || typeof spec !== "object") return fallback;
  const s = spec as Record<string, unknown>;
  const out = { ...fallback };
  if (s.orderBy) out.orderBy = s.orderBy;
  if (typeof s.take === "number") out.take = s.take;
  return out;
}

async function attachIndentRelations(
  indent: Record<string, unknown>,
  include?: Record<string, unknown>
) {
  const indentId = String(indent.id);
  const itemId = String(indent.itemId);
  const requesterId = String(indent.requesterId);
  const approvalSpec =
    include?.approvalEvents && typeof include.approvalEvents === "object"
      ? (include.approvalEvents as Record<string, unknown>)
      : undefined;
  const actorSpec =
    approvalSpec?.include && typeof approvalSpec.include === "object"
      ? (approvalSpec.include as Record<string, unknown>).actor
      : undefined;
  const actorSelect =
    actorSpec && typeof actorSpec === "object" && (actorSpec as { select?: unknown }).select
      ? ((actorSpec as { select: Record<string, unknown> }).select)
      : { id: true, name: true, role: true };

  const [item, requester, stateHistory, approvalEvents, documents, rfqs, quotations, vendorSelection, purchaseOrders, invoices, payments, aiRuns] =
    await Promise.all([
      selectUnique("items", { id: itemId }),
      selectFirst("users", userArgsFromInclude(include?.requester, { id: requesterId })),
      selectMany(
        "indent_state_history",
        relationQueryArgs(include?.stateHistory, {
          where: { indentId },
          orderBy: { createdAt: "asc" },
        })
      ),
      selectMany(
        "approval_events",
        relationQueryArgs(include?.approvalEvents, {
          where: { indentId },
          orderBy: { createdAt: "asc" },
        })
      ),
      selectMany(
        "documents",
        relationQueryArgs(include?.documents, {
          where: { indentId },
          orderBy: { createdAt: "desc" },
        })
      ),
      selectMany(
        "rfqs",
        relationQueryArgs(include?.rfqs, {
          where: { indentId },
          orderBy: { sentAt: "desc" },
        })
      ),
      selectMany("quotations", { where: { indentId } }),
      selectFirst("vendor_selection", { where: { indentId } }),
      selectMany("purchase_orders", { where: { indentId } }),
      selectMany("invoices", { where: { indentId } }),
      selectMany("payments", { where: { indentId } }),
      selectMany(
        "ai_comparison_runs",
        relationQueryArgs(include?.aiRuns, {
          where: { indentId },
          orderBy: { createdAt: "desc" },
          take: 3,
        })
      ),
    ]);

  const actorIds = [...new Set(approvalEvents.map((e) => String(e.actorId)).filter(Boolean))];
  const actors = actorIds.length
    ? await selectMany("users", { where: { id: { in: actorIds } }, select: actorSelect })
    : [];
  const actorById = new Map(actors.map((u) => [String(u.id), u]));
  const approvalsWithActor = approvalEvents.map((e) => ({
    ...e,
    actor: actorById.get(String(e.actorId)) ?? null,
  }));

  const rfqIds = rfqs.map((r) => String(r.id));
  const allRvs = rfqIds.length
    ? await selectMany("rfq_vendors", { where: { rfqId: { in: rfqIds } } })
    : [];
  const vendorIds = [
    ...new Set([
      ...allRvs.map((rv) => String(rv.vendorId)),
      ...quotations.map((q) => String(q.vendorId)),
      ...(vendorSelection?.selectedVendorId ? [String(vendorSelection.selectedVendorId)] : []),
      ...(vendorSelection?.aiRecommendedVendorId
        ? [String(vendorSelection.aiRecommendedVendorId)]
        : []),
    ]),
  ];
  const vendors = vendorIds.length
    ? await selectMany("vendors", { where: { id: { in: vendorIds } } })
    : [];
  const vendorById = new Map(vendors.map((v) => [String(v.id), v]));
  const docIds = quotations.map((q) => q.documentId).filter(Boolean).map(String);
  const docs = docIds.length ? await selectMany("documents", { where: { id: { in: docIds } } }) : [];
  const docById = new Map(docs.map((d) => [String(d.id), d]));

  const rfqsWithVendors = rfqs.map((r) => {
    const rvs = allRvs.filter((rv) => String(rv.rfqId) === String(r.id));
    return {
      ...r,
      vendors: rvs.map((rv) => ({
        ...rv,
        vendor: vendorById.get(String(rv.vendorId)) ?? null,
      })),
    };
  });
  const quotesWithVendor = quotations.map((q) => ({
    ...q,
    vendor: vendorById.get(String(q.vendorId)) ?? null,
    document: q.documentId ? docById.get(String(q.documentId)) ?? null : null,
  }));

  let vendorSel = vendorSelection;
  if (vendorSel) {
    vendorSel = {
      ...vendorSel,
      selectedVendor: vendorById.get(String(vendorSel.selectedVendorId)) ?? null,
      aiRecommendedVendor: vendorSel.aiRecommendedVendorId
        ? vendorById.get(String(vendorSel.aiRecommendedVendorId)) ?? null
        : null,
    };
  }

  return {
    ...indent,
    item,
    requester,
    stateHistory,
    approvalEvents: approvalsWithActor,
    documents,
    rfqs: rfqsWithVendors,
    quotations: quotesWithVendor,
    vendorSelection: vendorSel,
    purchaseOrders,
    invoices,
    payments,
    aiRuns,
  };
}

// Prisma-like compatibility layer backed by raw SQL.
export const prisma: any = {
  user: {
    findMany: async (args: Record<string, unknown> = {}) => selectMany("users", args),
    findFirst: async (args: Record<string, unknown> = {}) => selectFirst("users", args),
    findUnique: async (args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => selectFirst("users", args),
    create: async (args: { data: Record<string, unknown> }) => createRow("users", args.data),
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateRow("users", args.where, args.data),
    createMany: async (args: { data: Record<string, unknown>[] }) => createManyRows("users", args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => deleteManyRows("users", args.where),
  },
  role: {
    findMany: async (args: Record<string, unknown> = {}) => selectMany("roles", args),
    findFirst: async (args: Record<string, unknown> = {}) => selectFirst("roles", args),
    create: async (args: { data: Record<string, unknown> }) => createRow("roles", args.data),
  },
  item: {
    findMany: async (args: Record<string, unknown> = {}) => selectMany("items", args),
    findUnique: async (args: { where: Record<string, unknown> }) => selectUnique("items", args.where),
    create: async (args: { data: Record<string, unknown> }) => createRow("items", args.data),
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateRow("items", args.where, args.data),
    count: async (args: { where?: Record<string, unknown> } = {}) => countRows("items", args.where),
    delete: async (args: { where: Record<string, unknown> }) => {
      const row = await selectUnique("items", args.where);
      if (!row) return null;
      await deleteManyRows("items", args.where);
      return row;
    },
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => deleteManyRows("items", args.where),
  },
  vendor: {
    findMany: async (args: Record<string, unknown> = {}) => {
      const rows = await selectMany("vendors", args);
      if ((args.include as Record<string, unknown> | undefined)?.vendorItems) {
        return Promise.all(
          rows.map(async (v) => {
            const vendorItems = await selectMany("vendor_items", { where: { vendorId: v.id } });
            const withItems = await Promise.all(
              vendorItems.map(async (vi) => ({
                ...vi,
                item: await selectUnique("items", { id: String(vi.itemId) }),
              }))
            );
            return { ...v, vendorItems: withItems };
          })
        );
      }
      return rows;
    },
    findFirst: async (args: Record<string, unknown> = {}) => selectFirst("vendors", args),
    findUnique: async (args: { where: Record<string, unknown> }) => selectUnique("vendors", args.where),
    findUniqueOrThrow: async (args: { where: Record<string, unknown> }) => {
      const row = await selectUnique("vendors", args.where);
      if (!row) throw new Error("Not found");
      return row;
    },
    create: async (args: { data: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const data = { ...args.data };
      const nested = (data as { vendorItems?: { create?: { itemId: string }[] } }).vendorItems;
      delete (data as { vendorItems?: unknown }).vendorItems;
      const row = await createRow("vendors", data);
      if (nested?.create?.length) {
        await createManyRows(
          "vendor_items",
          nested.create.map((x) => ({ vendorId: row.id, itemId: x.itemId }))
        );
      }
      if (args.include?.vendorItems) {
        const vendorItems = await selectMany("vendor_items", { where: { vendorId: row.id } });
        return { ...row, vendorItems };
      }
      return row;
    },
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateRow("vendors", args.where, args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("vendors", args.where),
    count: async (args: { where?: Record<string, unknown> } = {}) => countRows("vendors", args.where),
  },
  vendorItem: {
    create: async (args: { data: Record<string, unknown> }) => createRow("vendor_items", args.data),
    createMany: async (args: { data: Record<string, unknown>[] }) => createManyRows("vendor_items", args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("vendor_items", args.where),
  },
  indent: {
    findMany: async (args: Record<string, unknown> = {}) => {
      const rows = await selectMany("indents", args);
      if (args.include) {
        return Promise.all(
          rows.map(async (r) => {
            const out: Record<string, unknown> = { ...r };
            const include = args.include as Record<string, unknown>;
            if (include.item) out.item = await selectUnique("items", { id: String(r.itemId) });
            if (include.requester) {
              out.requester = await selectFirst(
                "users",
                userArgsFromInclude(include.requester, { id: String(r.requesterId) })
              );
            }
            if (include.purchaseOrders) out.purchaseOrders = await selectMany("purchase_orders", { where: { indentId: r.id } });
            if (include.invoices) out.invoices = await selectMany("invoices", { where: { indentId: r.id } });
            if (include.payments) out.payments = await selectMany("payments", { where: { indentId: r.id } });
            return out;
          })
        );
      }
      return rows;
    },
    findFirst: async (args: Record<string, unknown> = {}) => selectFirst("indents", args),
    findUnique: async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const row = await selectUnique("indents", args.where);
      if (!row) return null;
      if (args.include) return attachIndentRelations(row, args.include);
      return row;
    },
    findUniqueOrThrow: async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const row = await prisma.indent.findUnique(args);
      if (!row) throw new Error("Not found");
      return row;
    },
    create: async (args: { data: Record<string, unknown> }) => createRow("indents", args.data),
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateRow("indents", args.where, args.data),
    count: async (args: { where?: Record<string, unknown> } = {}) => countRows("indents", args.where),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => deleteManyRows("indents", args.where),
  },
  indentStateHistory: {
    create: async (args: { data: Record<string, unknown> }) => createRow("indent_state_history", args.data),
    createMany: async (args: { data: Record<string, unknown>[] }) =>
      createManyRows("indent_state_history", args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("indent_state_history", args.where),
  },
  approvalEvent: {
    create: async (args: { data: Record<string, unknown> }) => createRow("approval_events", args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("approval_events", args.where),
  },
  rfq: {
    create: async (args: { data: Record<string, unknown> }) => {
      const data = { ...args.data };
      const vendors = (data as { vendors?: { create: { vendorId: string }[] } }).vendors;
      delete (data as { vendors?: unknown }).vendors;
      const rfq = await createRow("rfqs", data);
      if (vendors?.create?.length) {
        await createManyRows(
          "rfq_vendors",
          vendors.create.map((v) => ({ rfqId: rfq.id, vendorId: v.vendorId }))
        );
      }
      return rfq;
    },
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateRow("rfqs", args.where, args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => deleteManyRows("rfqs", args.where),
  },
  rfqVendor: {
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => deleteManyRows("rfq_vendors", args.where),
  },
  quotation: {
    findFirst: async (args: Record<string, unknown> = {}) => {
      const row = await selectFirst("quotations", args);
      if (!row) return null;
      if (args.include) {
        const include = args.include as Record<string, unknown>;
        const out: Record<string, unknown> = { ...row };
        if (include.vendor) out.vendor = await selectUnique("vendors", { id: String(row.vendorId) });
        if (include.document) out.document = row.documentId
          ? await selectUnique("documents", { id: String(row.documentId) })
          : null;
        if (include.indent) {
          const indent = await selectUnique("indents", { id: String(row.indentId) });
          if (indent && typeof include.indent === "object" && (include.indent as Record<string, unknown>).include) {
            out.indent = {
              ...indent,
              item: await selectUnique("items", { id: String(indent.itemId) }),
            };
          } else {
            out.indent = indent;
          }
        }
        return out;
      }
      return row;
    },
    create: async (args: { data: Record<string, unknown> }) => createRow("quotations", args.data),
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateRow("quotations", args.where, args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("quotations", args.where),
  },
  aiComparisonRun: {
    create: async (args: { data: Record<string, unknown> }) => createRow("ai_comparison_runs", args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("ai_comparison_runs", args.where),
  },
  vendorSelection: {
    upsert: async (args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const [key, value] = Object.entries(args.where)[0];
      return upsertRow("vendor_selection", key, value, args.create, args.update);
    },
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("vendor_selection", args.where),
  },
  purchaseOrder: {
    upsert: async (args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const [key, value] = Object.entries(args.where)[0];
      return upsertRow("purchase_orders", key, value, args.create, args.update);
    },
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateRow("purchase_orders", args.where, args.data),
    findFirst: async (args: Record<string, unknown> = {}) => {
      const row = await selectFirst("purchase_orders", args);
      if (!row) return null;
      if (args.include && (args.include as Record<string, unknown>).indent) {
        const indent = await selectUnique("indents", { id: String(row.indentId) });
        let withSelection = indent;
        const selection = indent
          ? await selectFirst("vendor_selection", { where: { indentId: indent.id } })
          : null;
        if (selection) {
          withSelection = {
            ...indent,
            vendorSelection: {
              ...selection,
              selectedVendor: await selectUnique("vendors", { id: String(selection.selectedVendorId) }),
            },
          };
        }
        return { ...row, indent: withSelection };
      }
      return row;
    },
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("purchase_orders", args.where),
  },
  invoice: {
    findMany: async (args: Record<string, unknown> = {}) => selectMany("invoices", args),
    findFirst: async (args: Record<string, unknown> = {}) => selectFirst("invoices", args),
    create: async (args: { data: Record<string, unknown> }) => createRow("invoices", args.data),
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateRow("invoices", args.where, args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => deleteManyRows("invoices", args.where),
  },
  payment: {
    findFirst: async (args: Record<string, unknown> = {}) => selectFirst("payments", args),
    create: async (args: { data: Record<string, unknown> }) => createRow("payments", args.data),
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateManyRows("payments", args.where, args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => deleteManyRows("payments", args.where),
  },
  document: {
    findMany: async (args: Record<string, unknown> = {}) => {
      const rows = await selectMany("documents", args);
      if (args.include && (args.include as Record<string, unknown>).indent) {
        return Promise.all(
          rows.map(async (d) => ({
            ...d,
            indent: d.indentId ? await selectUnique("indents", { id: String(d.indentId) }) : null,
          }))
        );
      }
      return rows;
    },
    findFirst: async (args: Record<string, unknown> = {}) => selectFirst("documents", args),
    findUnique: async (args: { where: Record<string, unknown> }) => selectUnique("documents", args.where),
    create: async (args: { data: Record<string, unknown> }) => createRow("documents", args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("documents", args.where),
  },
  notification: {
    findMany: async (args: Record<string, unknown> = {}) => {
      const rows = await selectMany("notifications", args);
      if (args.include && (args.include as Record<string, unknown>).indent) {
        return Promise.all(
          rows.map(async (n) => ({
            ...n,
            indent: n.indentId ? await selectUnique("indents", { id: String(n.indentId) }) : null,
          }))
        );
      }
      return rows;
    },
    createMany: async (args: { data: Record<string, unknown>[] }) =>
      createManyRows("notifications", args.data),
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateManyRows("notifications", args.where, args.data),
    count: async (args: { where?: Record<string, unknown> } = {}) =>
      countRows("notifications", args.where),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("notifications", args.where),
  },
  auditLog: {
    findMany: async (args: Record<string, unknown> = {}) => {
      const rows = await selectMany("audit_logs", args);
      if (args.include && (args.include as Record<string, unknown>).actor) {
        const actorInclude = (args.include as Record<string, unknown>).actor;
        return Promise.all(
          rows.map(async (l) => ({
            ...l,
            actor: l.actorId
              ? await selectFirst("users", userArgsFromInclude(actorInclude, { id: String(l.actorId) }))
              : null,
          }))
        );
      }
      return rows;
    },
    create: async (args: { data: Record<string, unknown> }) => createRow("audit_logs", args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("audit_logs", args.where),
  },
  gmailCredential: {
    findFirst: async () => selectFirst("gmail_credentials"),
    create: async (args: { data: Record<string, unknown> }) => createRow("gmail_credentials", args.data),
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      updateRow("gmail_credentials", args.where, args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("gmail_credentials", args.where),
  },
  gmailIngestedMessage: {
    findUnique: async (args: { where: Record<string, unknown> }) =>
      selectUnique("gmail_ingested_messages", args.where),
    create: async (args: { data: Record<string, unknown> }) =>
      createRow("gmail_ingested_messages", args.data),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) =>
      deleteManyRows("gmail_ingested_messages", args.where),
  },
} as const;
