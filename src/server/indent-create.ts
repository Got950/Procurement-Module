import { prisma, query, withTransaction } from "@/lib/db";
import { IndentStatus } from "@/lib/domain-types";
import { appendAudit } from "@/server/audit-service";

/** Atomic allocation: concurrent creations get distinct references. */
export async function allocateIndentReference() {
  const year = new Date().getFullYear();
  const result = await query<{ last_value: number }>(
    `INSERT INTO indent_reference_counters (year, last_value) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_value = indent_reference_counters.last_value + 1
     RETURNING last_value`,
    [year]
  );
  return `IND-${year}-${String(result.rows[0].last_value).padStart(4, "0")}`;
}

export type CreateIndentInput = {
  itemId: string;
  quantity: number;
  justification: string;
  priority?: string;
  estimatedAmount?: number;
};

/**
 * Creates a draft indent for the authenticated requester. Same rules as
 * POST /api/indents — used by the UI route and Copilot so behaviour stays one.
 */
export async function createDraftIndent(actorId: string, input: CreateIndentInput) {
  return withTransaction(async () => {
    const reference = await allocateIndentReference();
    const created = await prisma.indent.create({
      data: {
        reference,
        requesterId: actorId,
        itemId: input.itemId,
        quantity: input.quantity,
        priority: input.priority ?? "NORMAL",
        justification: input.justification,
        estimatedAmount: input.estimatedAmount,
        currentStatus: IndentStatus.DRAFT,
      },
    });
    await prisma.indentStateHistory.create({
      data: { indentId: created.id, toStatus: IndentStatus.DRAFT },
    });
    await appendAudit({
      entityType: "Indent",
      entityId: created.id,
      action: "CREATE",
      actorId,
      indentId: created.id,
      diff: { reference },
    });
    return created;
  });
}

export type UpdateDraftIndentInput = {
  quantity?: number;
  priority?: string;
  justification?: string;
  estimatedAmount?: number;
  itemId?: string;
};

/**
 * Updates allowlisted draft fields with optimistic locking. Same rules as
 * PATCH /api/indents/[id].
 */
export async function updateDraftIndent(
  actorId: string,
  indentId: string,
  version: number,
  input: UpdateDraftIndentInput
) {
  const updated = await prisma.indent.update({
    where: { id: indentId, version, currentStatus: IndentStatus.DRAFT },
    data: {
      itemId: input.itemId ?? undefined,
      quantity: input.quantity ?? undefined,
      priority: input.priority ?? undefined,
      justification: input.justification ?? undefined,
      estimatedAmount: input.estimatedAmount ?? undefined,
      version: version + 1,
    },
  });
  if (updated) {
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: "UPDATE",
      actorId,
      indentId,
      diff: input as object,
    });
  }
  return updated;
}
