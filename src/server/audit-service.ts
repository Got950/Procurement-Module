import { prisma } from "@/lib/db";
import { getCorrelationId, getRequestSource, type RequestSource } from "@/lib/logger";

export async function appendAudit(params: {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string | null;
  indentId?: string | null;
  diff?: object;
  /** Overrides ALS request source when provided. */
  source?: RequestSource;
}) {
  const source = params.source ?? getRequestSource() ?? "UI";
  await prisma.auditLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      actorId: params.actorId ?? undefined,
      indentId: params.indentId ?? undefined,
      diffJson: params.diff ?? undefined,
      correlationId: getCorrelationId() ?? undefined,
      source,
    },
  });
}
