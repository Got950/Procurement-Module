import type { IndentStatus, Role } from "@/lib/domain-types";
import { lockIndent, prisma, withTransaction } from "@/lib/db";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { canProcurement } from "@/lib/rbac/policies";
import { appendAudit } from "@/server/audit-service";

export type ProcurementRequirementsInput = {
  costRequirement?: string;
  deliveryRequirement?: string;
  specificationsRequirement?: string;
  approvalBudgetAmount?: number | null;
};

/**
 * The only writer of the approval-routing amount. Editing is confined to the
 * procurement stages: once a case has left QUOTES_READY an approval has been
 * requested against a specific number, so changing it afterwards would move the
 * case between approval tiers invisibly.
 */
const EDITABLE_STATUSES: readonly IndentStatus[] = [
  "PROCUREMENT_ACTIVE",
  "RFQ_SENT",
  "AWAITING_QUOTES",
  "QUOTES_READY",
];

export async function persistProcurementRequirements(
  indentId: string,
  actor: { id: string; role: Role },
  data: ProcurementRequirementsInput
): Promise<number | null> {
  if (!canProcurement(actor.role)) throw new AuthorizationError();

  return withTransaction(async () => {
    if (!(await lockIndent(indentId))) throw new NotFoundError("Indent not found");
    const before = await prisma.indent.findUnique({ where: { id: indentId } });
    if (!before) throw new NotFoundError("Indent not found");
    if (!EDITABLE_STATUSES.includes(before.currentStatus as IndentStatus)) {
      throw new ConflictError(
        `Commercial requirements can no longer be changed: the case is at ${before.currentStatus}.`
      );
    }

    const cost = data.costRequirement?.trim() ?? "";
    const delivery = data.deliveryRequirement?.trim() ?? "";
    const specs = data.specificationsRequirement?.trim() ?? "";

    // Omitting the field leaves the stored amount alone. Previously any caller
    // that did not send it silently nulled the approval-routing amount.
    let approvalAmount = before.approvalBudgetAmount as number | string | null;
    if (data.approvalBudgetAmount !== undefined) {
      if (data.approvalBudgetAmount === null) {
        approvalAmount = null;
      } else if (
        !Number.isFinite(data.approvalBudgetAmount) ||
        data.approvalBudgetAmount < 0
      ) {
        throw new ValidationError("Approval value must be a number of zero or more");
      } else {
        approvalAmount = data.approvalBudgetAmount;
      }
    }

    const after = await prisma.indent.update({
      where: { id: indentId },
      data: {
        procurementCostCommercial: cost || null,
        procurementDeliveryExpectations: delivery || null,
        procurementSpecifications: specs || null,
        approvalBudgetAmount: approvalAmount,
      },
    });
    if (!after) throw new NotFoundError("Indent not found");

    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: "PROCUREMENT_REQUIREMENTS_SAVED",
      actorId: actor.id,
      indentId,
      diff: {
        before: {
          procurementCostCommercial: before.procurementCostCommercial,
          procurementDeliveryExpectations: before.procurementDeliveryExpectations,
          procurementSpecifications: before.procurementSpecifications,
          approvalBudgetAmount: before.approvalBudgetAmount,
        },
        after: {
          procurementCostCommercial: after.procurementCostCommercial,
          procurementDeliveryExpectations: after.procurementDeliveryExpectations,
          procurementSpecifications: after.procurementSpecifications,
          approvalBudgetAmount: after.approvalBudgetAmount,
        },
      },
    });

    return approvalAmount == null ? null : Number(approvalAmount);
  });
}
