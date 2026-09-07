import {
  ApprovalDecision,
  ApprovalStage,
  IndentStatus,
  NotificationType,
  Role,
} from "@/lib/domain-types";
import { lockIndent, prisma, query, withTransaction } from "@/lib/db";
import {
  AuthorizationError,
  ConflictError,
  DomainRuleError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { assertTransition } from "@/server/domain/state-machine";
import {
  getIndentBudgetTrack,
  isDirectorObserveStatus,
  requiresDirectorApproval,
  requiresMdApproval,
  resolveIndentBudgetAmount,
} from "@/lib/budget-approval";
import {
  canApproveIndent,
  canApproveVendorChoice,
  canDirectorApprove,
  canFinance,
  canMdApprove,
  canProcurement,
} from "@/lib/rbac/policies";
import { appendAudit } from "@/server/audit-service";
import { notifyUsers } from "@/server/notification-service";

/**
 * Every mutating use case below runs in exactly one transaction and takes the
 * indent row lock first, so a case cannot be half-written and two actors cannot
 * act on the same case at the same time.
 */
async function withIndentTransaction<T>(indentId: string, fn: () => Promise<T>): Promise<T> {
  return withTransaction(async () => {
    if (!(await lockIndent(indentId))) throw new NotFoundError("Indent not found");
    return fn();
  });
}

async function assertDistinctApprover(indentId: string, actorId: string, stage: string) {
  // SoD applies to the spend-approval chain. The two Team Leader stages are the
  // same role in this product (indent vs vendor), so blocking those would make
  // a one-TL team unable to operate.
  const spendStages = ["TEAM_LEADER_VENDOR", "DIRECTOR_VENDOR", "MD_VENDOR"];
  if (!spendStages.includes(stage)) return;
  const prior = await query(
    `SELECT id FROM approval_events
      WHERE indent_id = $1 AND actor_id = $2
        AND stage = ANY($3::text[])
      LIMIT 1`,
    [indentId, actorId, spendStages]
  );
  if (prior.rows[0]) {
    throw new DomainRuleError(
      "The same person cannot act at more than one vendor-approval stage on a case."
    );
  }
}

const REJECTION_STATUSES = new Set<IndentStatus>([
  "REJECTED_TL_INDENT",
  "REJECTED_TL_VENDOR",
  "REJECTED_DIRECTOR",
  "REJECTED_MD",
]);

/**
 * The only writer of `indents.current_status`. The target must be reachable from
 * `from` per the transition table, and the UPDATE is conditional on the case
 * still being at `from` — so a concurrent actor gets a 409 instead of silently
 * overwriting the first decision.
 */
async function transitionStatus(
  indentId: string,
  to: IndentStatus,
  actorId: string | null,
  note: string | undefined,
  from: IndentStatus
) {
  if (from === to) return null;
  assertTransition(from, to);
  const indent = await prisma.indent.update({
    where: { id: indentId, currentStatus: from },
    data: {
      currentStatus: to,
      ...(REJECTION_STATUSES.has(to) ? { rejectionReason: note ?? null } : {}),
    },
  });
  if (!indent) {
    throw new ConflictError(
      `This case is no longer at ${from}. Refresh to see its current state.`
    );
  }
  await prisma.indentStateHistory.create({
    data: {
      indentId,
      fromStatus: from,
      toStatus: to,
      actorId: actorId ?? undefined,
      note,
    },
  });
  if (getIndentBudgetTrack(indent) === "TL_ONLY" && isDirectorObserveStatus(to)) {
    await notifyExecutiveObservers(
      indentId,
      indent.reference,
      `Now at ${String(to).replace(/_/g, " ")} (≤ ₹50k — no approval needed).`
    );
  }
  return indent;
}

async function notifyExecutiveObservers(indentId: string, reference: string, body: string) {
  const executives = await prisma.user.findMany({
    where: { role: { in: ["DIRECTOR", "MD"] }, isActive: true },
    select: { id: true },
  });
  if (executives.length === 0) return;
  await notifyUsers(
    executives.map((u) => u.id),
    {
      type: NotificationType.STATUS_CHANGE,
      title: "Case update (view only)",
      body: `${reference}: ${body}`,
      indentId,
    }
  );
}

export async function submitIndent(indentId: string, requesterId: string) {
  return withIndentTransaction(indentId, async () => {
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.requesterId !== requesterId) throw new AuthorizationError();
    if (i.currentStatus !== "DRAFT") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    await transitionStatus(indentId, "PENDING_TL_INDENT", requesterId, undefined, i.currentStatus);
    const tls = await prisma.user.findMany({
      where: { role: "TEAM_LEADER", isActive: true },
      select: { id: true },
    });
    await notifyUsers(
      tls.map((u) => u.id),
      {
        type: NotificationType.APPROVAL_REQUIRED,
        title: "Indent pending review",
        body: `Indent ${i.reference} awaits team leader approval.`,
        indentId,
      }
    );
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: "SUBMIT",
      actorId: requesterId,
      indentId,
      diff: { to: "PENDING_TL_INDENT" },
    });
  });
}

export async function tlDecisionOnIndent(
  indentId: string,
  actorId: string,
  role: Role,
  decision: ApprovalDecision,
  remarks: string
) {
  return withIndentTransaction(indentId, async () => {
    if (!remarks.trim()) throw new ValidationError("Remarks are required");
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.currentStatus !== "PENDING_TL_INDENT") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    if (!canApproveIndent(role, i.currentStatus)) throw new AuthorizationError();
    await assertDistinctApprover(indentId, actorId, ApprovalStage.TEAM_LEADER_INDENT);
    await prisma.approvalEvent.create({
      data: {
        indentId,
        stage: ApprovalStage.TEAM_LEADER_INDENT,
        actorId,
        decision,
        remarks,
        // The decision is a statement about this amount and tier, so record
        // both: the indent columns can change afterwards.
        budgetAmountAtDecision: resolveIndentBudgetAmount(i),
        budgetTrackAtDecision: getIndentBudgetTrack(i),
      },
    });
    if (decision === "APPROVED") {
      await transitionStatus(indentId, "PROCUREMENT_ACTIVE", actorId, undefined, i.currentStatus);
      const procs = await prisma.user.findMany({
        where: { role: "PROCUREMENT", isActive: true },
        select: { id: true },
      });
      await notifyUsers(
        procs.map((u) => u.id),
        {
          type: NotificationType.STATUS_CHANGE,
          title: "Indent approved",
          body: `${i.reference} is ready for procurement.`,
          indentId,
        }
      );
    } else {
      await transitionStatus(
        indentId,
        "REJECTED_TL_INDENT",
        actorId,
        remarks,
        i.currentStatus
      );
      await notifyUsers([i.requesterId], {
        type: NotificationType.REJECTION,
        title: "Indent rejected",
        body: `${i.reference}: ${remarks}`,
        indentId,
      });
    }
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: `TL_INDENT_${decision}`,
      actorId,
      indentId,
      diff: { decision, remarks },
    });
  });
}

export async function createRfqAndMarkSent(
  indentId: string,
  actorId: string,
  role: Role,
  data: { subject: string; bodyTemplate: string; vendorIds: string[]; gmailThreadId?: string }
) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    // Allow first send from PROCUREMENT_ACTIVE (or quote stages), and follow-up sends while still in RFQ_SENT.
    const allowed: IndentStatus[] = [
      "PROCUREMENT_ACTIVE",
      "AWAITING_QUOTES",
      "QUOTES_READY",
      "RFQ_SENT",
    ];
    if (!allowed.includes(i.currentStatus as IndentStatus)) {
      throw new ConflictError(
        `Cannot send an RFQ while the case is at ${i.currentStatus}. Refresh and retry.`
      );
    }
    const rfq = await prisma.rfq.create({
      data: {
        indentId,
        subject: data.subject,
        bodyTemplate: data.bodyTemplate,
        sentAt: new Date(),
        gmailThreadId: data.gmailThreadId ?? null,
        vendors: {
          create: data.vendorIds.map((vendorId) => ({ vendorId })),
        },
      },
    });
    if (i.currentStatus !== "RFQ_SENT") {
      await transitionStatus(indentId, "RFQ_SENT", actorId, undefined, i.currentStatus);
    }
    await appendAudit({
      entityType: "Rfq",
      entityId: rfq.id,
      action: "RFQ_SENT",
      actorId,
      indentId,
      diff: { vendorIds: data.vendorIds },
    });
    return rfq;
  });
}

/** After RFQ: procurement moves to awaiting quotes (manual or Gmail). */
export async function setAwaitingQuotes(indentId: string, actorId: string, role: Role) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.currentStatus !== "RFQ_SENT") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    await transitionStatus(indentId, "AWAITING_QUOTES", actorId, undefined, i.currentStatus);
  });
}

export async function markQuotesReady(indentId: string, actorId: string, role: Role) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (
      i.currentStatus !== "AWAITING_QUOTES" &&
      i.currentStatus !== "RFQ_SENT" &&
      i.currentStatus !== "PROCUREMENT_ACTIVE"
    ) {
      throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    }
    await transitionStatus(indentId, "QUOTES_READY", actorId, undefined, i.currentStatus);
  });
}

/**
 * Approval tiers are chosen from the entered amount, so an amount below what the
 * selected vendor actually quoted is how the Director and MD tiers get skipped
 * (F-03). Refuse rather than warn: an approval for less than the case will cost
 * is wrong even when nobody is gaming it.
 *
 * ponytail: the quoted total is derived as unit price x indent quantity, since
 * quotations store no total. That ignores freight, taxes and pack sizes, so it
 * is a floor, not the invoice value; it only fires when a quotation carries a
 * unit price. A `quotations.total_amount` column captured at extraction time
 * would make this exact.
 */
async function assertBudgetCoversSelectedQuotation(
  indentId: string,
  selectedVendorId: string,
  indent: { quantity: string | number },
  budgetAmount: number
) {
  const quantity = Number(indent.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return;

  const result = await query<{ lowest_unit_price: string | null }>(
    `SELECT MIN(unit_price)::text AS lowest_unit_price FROM quotations
      WHERE indent_id = $1 AND vendor_id = $2 AND unit_price > 0`,
    [indentId, selectedVendorId]
  );
  const lowestUnitPrice = Number(result.rows[0]?.lowest_unit_price);
  if (!Number.isFinite(lowestUnitPrice)) return;

  const quotedTotal = lowestUnitPrice * quantity;
  if (budgetAmount < quotedTotal) {
    throw new DomainRuleError(
      `Approval value (INR ${budgetAmount}) is below the selected vendor's quoted total ` +
        `(INR ${quotedTotal.toFixed(2)} = unit price x quantity). Correct the approval value before sending.`
    );
  }
}

export async function submitVendorSelectionToTl(
  indentId: string,
  actorId: string,
  role: Role,
  payload: {
    selectedVendorId: string;
    aiRecommendedVendorId: string | null;
    overrideReason: string | null;
  }
) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.currentStatus !== "QUOTES_READY") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    const budgetAmount = resolveIndentBudgetAmount(i);
    if (budgetAmount == null) {
      throw new DomainRuleError(
        "Set the Approval value (INR) before sending to Team Lead."
      );
    }
    if (
      payload.aiRecommendedVendorId &&
      payload.selectedVendorId !== payload.aiRecommendedVendorId &&
      !payload.overrideReason?.trim()
    ) {
      throw new ValidationError("Override reason required when diverging from AI recommendation");
    }
    await assertBudgetCoversSelectedQuotation(indentId, payload.selectedVendorId, i, budgetAmount);
    await prisma.vendorSelection.upsert({
      where: { indentId },
      create: {
        indentId,
        selectedVendorId: payload.selectedVendorId,
        aiRecommendedVendorId: payload.aiRecommendedVendorId,
        overrideReason: payload.overrideReason,
        submittedAt: new Date(),
      },
      update: {
        selectedVendorId: payload.selectedVendorId,
        aiRecommendedVendorId: payload.aiRecommendedVendorId,
        overrideReason: payload.overrideReason,
        submittedAt: new Date(),
      },
    });
    await transitionStatus(indentId, "PENDING_TL_VENDOR", actorId, undefined, i.currentStatus);
    const tls = await prisma.user.findMany({
      where: { role: "TEAM_LEADER", isActive: true },
      select: { id: true },
    });
    await notifyUsers(
      tls.map((u) => u.id),
      {
        type: NotificationType.APPROVAL_REQUIRED,
        title: "Vendor selection pending",
        body: `Please review vendor choice for ${i.reference}.`,
        indentId,
      }
    );
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: "VENDOR_SUBMITTED_TL",
      actorId,
      indentId,
      diff: payload,
    });
  });
}

export async function tlDecisionOnVendor(
  indentId: string,
  actorId: string,
  role: Role,
  decision: ApprovalDecision,
  remarks: string
) {
  return withIndentTransaction(indentId, async () => {
    if (!remarks.trim()) throw new ValidationError("Remarks are required");
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.currentStatus !== "PENDING_TL_VENDOR") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    if (!canApproveVendorChoice(role, i.currentStatus)) throw new AuthorizationError();
    await assertDistinctApprover(indentId, actorId, ApprovalStage.TEAM_LEADER_VENDOR);
    await prisma.approvalEvent.create({
      data: {
        indentId,
        stage: ApprovalStage.TEAM_LEADER_VENDOR,
        actorId,
        decision,
        remarks,
        // The decision is a statement about this amount and tier, so record
        // both: the indent columns can change afterwards.
        budgetAmountAtDecision: resolveIndentBudgetAmount(i),
        budgetTrackAtDecision: getIndentBudgetTrack(i),
      },
    });
    if (decision === "APPROVED") {
      const track = getIndentBudgetTrack(i);
      if (!requiresDirectorApproval(track)) {
        await transitionStatus(indentId, "PROCUREMENT_PO", actorId, undefined, i.currentStatus);
        const procs = await prisma.user.findMany({
          where: { role: "PROCUREMENT", isActive: true },
          select: { id: true },
        });
        await notifyUsers(
          procs.map((u) => u.id),
          {
            type: NotificationType.STATUS_CHANGE,
            title: "Raise PO",
            body: `Vendor approved for ${i.reference} (≤ ₹50k track — no Director sign-off).`,
            indentId,
          }
        );
      } else {
        await transitionStatus(indentId, "PENDING_DIRECTOR", actorId, undefined, i.currentStatus);
        const dirs = await prisma.user.findMany({
          where: { role: "DIRECTOR", isActive: true },
          select: { id: true },
        });
        await notifyUsers(
          dirs.map((u) => u.id),
          {
            type: NotificationType.APPROVAL_REQUIRED,
            title: "Director approval",
            body: `Vendor selection for ${i.reference} needs your approval.`,
            indentId,
          }
        );
      }
    } else {
      await transitionStatus(
        indentId,
        "REJECTED_TL_VENDOR",
        actorId,
        remarks,
        i.currentStatus
      );
      const procs = await prisma.user.findMany({
        where: { role: "PROCUREMENT", isActive: true },
        select: { id: true },
      });
      await notifyUsers(
        [...procs.map((u) => u.id), i.requesterId],
        {
          type: NotificationType.REJECTION,
          title: "Vendor choice rejected",
          body: `${i.reference}: ${remarks}`,
          indentId,
        }
      );
    }
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: `TL_VENDOR_${decision}`,
      actorId,
      indentId,
      diff: { remarks },
    });
  });
}

export async function directorDecision(
  indentId: string,
  actorId: string,
  role: Role,
  decision: ApprovalDecision,
  remarks: string
) {
  return withIndentTransaction(indentId, async () => {
    if (!remarks.trim()) throw new ValidationError("Remarks are required");
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.currentStatus !== "PENDING_DIRECTOR") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    if (!canDirectorApprove(role, i.currentStatus)) throw new AuthorizationError();
    await assertDistinctApprover(indentId, actorId, ApprovalStage.DIRECTOR_VENDOR);
    await prisma.approvalEvent.create({
      data: {
        indentId,
        stage: ApprovalStage.DIRECTOR_VENDOR,
        actorId,
        decision,
        remarks,
        // The decision is a statement about this amount and tier, so record
        // both: the indent columns can change afterwards.
        budgetAmountAtDecision: resolveIndentBudgetAmount(i),
        budgetTrackAtDecision: getIndentBudgetTrack(i),
      },
    });
    if (decision === "APPROVED") {
      const track = getIndentBudgetTrack(i);
      if (requiresMdApproval(track)) {
        await transitionStatus(indentId, "PENDING_MD", actorId, undefined, i.currentStatus);
        const mds = await prisma.user.findMany({
          where: { role: "MD", isActive: true },
          select: { id: true },
        });
        await notifyUsers(
          mds.map((u) => u.id),
          {
            type: NotificationType.APPROVAL_REQUIRED,
            title: "MD approval",
            body: `Vendor selection for ${i.reference} needs MD approval (> ₹5L).`,
            indentId,
          }
        );
      } else {
        await transitionStatus(indentId, "PROCUREMENT_PO", actorId, undefined, i.currentStatus);
        const procs = await prisma.user.findMany({
          where: { role: "PROCUREMENT", isActive: true },
          select: { id: true },
        });
        await notifyUsers(
          procs.map((u) => u.id),
          {
            type: NotificationType.STATUS_CHANGE,
            title: "Director approved",
            body: `Raise PO for ${i.reference}.`,
            indentId,
          }
        );
      }
    } else {
      await transitionStatus(
        indentId,
        "REJECTED_DIRECTOR",
        actorId,
        remarks,
        i.currentStatus
      );
      await notifyUsers([i.requesterId], {
        type: NotificationType.REJECTION,
        title: "Director rejected",
        body: `${i.reference}: ${remarks}`,
        indentId,
      });
    }
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: `DIRECTOR_${decision}`,
      actorId,
      indentId,
      diff: { remarks },
    });
  });
}

export async function mdDecision(
  indentId: string,
  actorId: string,
  role: Role,
  decision: ApprovalDecision,
  remarks: string
) {
  return withIndentTransaction(indentId, async () => {
    if (!remarks.trim()) throw new ValidationError("Remarks are required");
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.currentStatus !== "PENDING_MD") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    if (!canMdApprove(role, i.currentStatus)) throw new AuthorizationError();
    await assertDistinctApprover(indentId, actorId, ApprovalStage.MD_VENDOR);
    if (!requiresMdApproval(getIndentBudgetTrack(i))) {
      throw new DomainRuleError("MD approval is not required for this budget");
    }
    await prisma.approvalEvent.create({
      data: {
        indentId,
        stage: ApprovalStage.MD_VENDOR,
        actorId,
        decision,
        remarks,
        // The decision is a statement about this amount and tier, so record
        // both: the indent columns can change afterwards.
        budgetAmountAtDecision: resolveIndentBudgetAmount(i),
        budgetTrackAtDecision: getIndentBudgetTrack(i),
      },
    });
    if (decision === "APPROVED") {
      await transitionStatus(indentId, "PROCUREMENT_PO", actorId, undefined, i.currentStatus);
      const procs = await prisma.user.findMany({
        where: { role: "PROCUREMENT", isActive: true },
        select: { id: true },
      });
      await notifyUsers(
        procs.map((u) => u.id),
        {
          type: NotificationType.STATUS_CHANGE,
          title: "MD approved",
          body: `Raise PO for ${i.reference}.`,
          indentId,
        }
      );
    } else {
      await transitionStatus(indentId, "REJECTED_MD", actorId, remarks, i.currentStatus);
      await notifyUsers([i.requesterId], {
        type: NotificationType.REJECTION,
        title: "MD rejected",
        body: `${i.reference}: ${remarks}`,
        indentId,
      });
    }
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: `MD_${decision}`,
      actorId,
      indentId,
      diff: { remarks },
    });
  });
}

export async function savePoDraft(
  indentId: string,
  actorId: string,
  role: Role,
  data: { poNumber: string; bodyHtml: string; bodyJson: object }
) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.currentStatus !== "PROCUREMENT_PO" && i.currentStatus !== "PO_DRAFT") {
      throw new ConflictError("The case is not ready for a purchase order. Refresh and retry.");
    }
    // po_number is globally unique, so an upsert on it alone would let a
    // client-supplied number overwrite another case's purchase order.
    const claimed = await prisma.purchaseOrder.findFirst({
      where: { poNumber: data.poNumber },
    });
    if (claimed && claimed.indentId !== indentId) {
      throw new ConflictError("That PO number is already used by another case");
    }
    const po = await prisma.purchaseOrder.upsert({
      where: { poNumber: data.poNumber },
      create: {
        indentId,
        poNumber: data.poNumber,
        bodyHtml: data.bodyHtml,
        bodyJson: data.bodyJson,
      },
      update: { bodyHtml: data.bodyHtml, bodyJson: data.bodyJson },
    });
    await transitionStatus(indentId, "PO_DRAFT", actorId, undefined, i.currentStatus);
    await appendAudit({
      entityType: "PurchaseOrder",
      entityId: po.id,
      action: "PO_DRAFT_SAVE",
      actorId,
      indentId,
      diff: { poNumber: data.poNumber },
    });
    return po;
  });
}

export async function sendPo(
  indentId: string,
  actorId: string,
  role: Role,
  poId: string,
  gmailMessageId?: string
) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.currentStatus !== "PO_DRAFT" && i.currentStatus !== "PROCUREMENT_PO") {
      throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    }
    // Scoped to this indent: the PO id comes from the client, so an id belonging
    // to another case must not match.
    const po = await prisma.purchaseOrder.update({
      where: { id: poId, indentId },
      data: { sentAt: new Date(), gmailMessageId: gmailMessageId ?? null },
    });
    if (!po) throw new NotFoundError("Purchase order not found for this case");
    await transitionStatus(indentId, "PO_SENT", actorId, undefined, i.currentStatus);
    await appendAudit({
      entityType: "PurchaseOrder",
      entityId: poId,
      action: "PO_SENT",
      actorId,
      indentId,
      diff: { gmailMessageId },
    });
  });
}

export async function recordInvoice(
  indentId: string,
  actorId: string,
  role: Role,
  data: {
    vendorName: string;
    amount?: number;
    purchaseOrderId?: string;
    documentId?: string;
    kind?: "PROFORMA" | "FINAL";
  }
) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const kind = data.kind ?? "PROFORMA";
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });

    if (kind === "PROFORMA") {
      const allowed: IndentStatus[] = ["PO_SENT", "PO_DRAFT", "PROCUREMENT_PO", "AWAITING_INVOICE"];
      if (!allowed.includes(i.currentStatus as IndentStatus)) throw new ConflictError("The case is not ready for a proforma invoice. Refresh and retry.");
      if (!data.documentId?.trim()) {
        throw new ValidationError("Proforma PDF is required — upload the file first");
      }

      const existingRows = await prisma.invoice.findMany({
        where: { indentId, kind: "PROFORMA" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      const existing = existingRows[0] as Record<string, unknown> | undefined;

      if (existing) {
        await prisma.invoice.update({
          where: { id: String(existing.id) },
          data: {
            vendorName: data.vendorName,
            amount: data.amount !== undefined ? data.amount : null,
            purchaseOrderId: data.purchaseOrderId ?? null,
            documentId: data.documentId ?? null,
          },
        });
      } else {
        await prisma.invoice.create({
          data: {
            indentId,
            kind: "PROFORMA",
            vendorName: data.vendorName,
            amount: data.amount !== undefined ? data.amount : null,
            purchaseOrderId: data.purchaseOrderId ?? null,
            documentId: data.documentId ?? null,
          },
        });
      }

      const from = i.currentStatus as IndentStatus;
      if (from !== "AWAITING_INVOICE") {
        await transitionStatus(indentId, "AWAITING_INVOICE", actorId, undefined, from);
      }

      await appendAudit({
        entityType: "Invoice",
        entityId: indentId,
        action: "PROCUREMENT_PROFORMA_SAVED",
        actorId,
        indentId,
        diff: data,
      });
      return;
    }

    if (i.currentStatus !== "PAYMENT_DONE") throw new ConflictError("The case is not ready for a final invoice. Refresh and retry.");
    if (!data.documentId?.trim()) {
      throw new ValidationError("Final invoice PDF is required — upload the file first");
    }

    const existingRows = await prisma.invoice.findMany({
      where: { indentId, kind: "FINAL" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    const existing = existingRows[0] as Record<string, unknown> | undefined;

    if (existing) {
      await prisma.invoice.update({
        where: { id: String(existing.id) },
        data: {
          vendorName: data.vendorName,
          amount: data.amount !== undefined ? data.amount : null,
          purchaseOrderId: data.purchaseOrderId ?? null,
          documentId: data.documentId ?? null,
        },
      });
    } else {
      await prisma.invoice.create({
        data: {
          indentId,
          kind: "FINAL",
          vendorName: data.vendorName,
          amount: data.amount !== undefined ? data.amount : null,
          purchaseOrderId: data.purchaseOrderId ?? null,
          documentId: data.documentId ?? null,
        },
      });
    }

    await appendAudit({
      entityType: "Invoice",
      entityId: indentId,
      action: "PROCUREMENT_FINAL_INVOICE_SAVED",
      actorId,
      indentId,
      diff: data,
    });
  });
}

export async function sendIndentToFinance(indentId: string, actorId: string, role: Role) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId }, include: { item: true } });
    if (i.currentStatus !== "AWAITING_INVOICE") throw new DomainRuleError("Save the proforma invoice first, then send to finance");
    if (i.purchaseOrders.length === 0) throw new DomainRuleError("A purchase order is required");
    const invRows = await prisma.invoice.findMany({
      where: { indentId, kind: "PROFORMA" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    const inv = invRows[0] as { documentId?: string | null } | undefined;
    if (!inv?.documentId) throw new DomainRuleError("The proforma PDF must be recorded before sending to finance");

    await transitionStatus(indentId, "PENDING_FINANCE", actorId, undefined, i.currentStatus as IndentStatus);
    const fins = await prisma.user.findMany({
      where: { role: "FINANCE", isActive: true },
      select: { id: true },
    });
    await notifyUsers(
      fins.map((u) => u.id),
      {
        type: NotificationType.APPROVAL_REQUIRED,
        title: "Finance — case ready",
        body: `Accounts review for ${i.reference}: PO and proforma attached.`,
        indentId,
      }
    );
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: "SENT_TO_FINANCE",
      actorId,
      indentId,
      diff: {},
    });
  });
}

export async function financeCompleteAccounts(
  indentId: string,
  actorId: string,
  role: Role,
  data: {
    budgetAllocation: string;
    budgetUtilized: string;
    availableBalance: string;
    fundsAvailable: string;
    accountNo: string;
    ifscCode: string;
    branchName: string;
    accountHolderName: string;
    remarks: string;
  }
) {
  return withIndentTransaction(indentId, async () => {
    if (!canFinance(role)) throw new AuthorizationError();
    const fields = [
      data.budgetAllocation,
      data.budgetUtilized,
      data.availableBalance,
      data.fundsAvailable,
      data.accountNo,
      data.ifscCode,
      data.branchName,
      data.accountHolderName,
      data.remarks,
    ];
    if (fields.some((s) => typeof s !== "string" || !String(s).trim())) {
      throw new ValidationError("All accounts section fields are required");
    }

    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId }, include: { item: true } });
    if (i.currentStatus !== "PENDING_FINANCE") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    const pos = i.purchaseOrders as unknown[] | undefined;
    const proformaRows = await prisma.invoice.findMany({
      where: { indentId, kind: "PROFORMA" },
      take: 1,
    });
    if (!pos?.length || proformaRows.length === 0) {
      throw new DomainRuleError("A purchase order and proforma invoice are required");
    }

    const existing = await prisma.payment.findFirst({
      where: { indentId, status: "COMPLETED" },
    });
    if (existing) throw new ConflictError("This case is already completed.");

    await prisma.indent.update({
      where: { id: indentId },
      data: {
        financeBudgetAllocation: data.budgetAllocation.trim(),
        financeBudgetUtilized: data.budgetUtilized.trim(),
        financeAvailableBalance: data.availableBalance.trim(),
        financeFundsAvailable: data.fundsAvailable.trim(),
        financeAccountNo: data.accountNo.trim(),
        financeIfscCode: data.ifscCode.trim(),
        financeBranchName: data.branchName.trim(),
        financeAccountHolderName: data.accountHolderName.trim(),
        financeRemarks: data.remarks.trim(),
        financeCompletedAt: new Date(),
      },
    });

    await prisma.payment.create({
      data: {
        indentId,
        status: "COMPLETED",
        proofDocumentId: null,
        recordedById: actorId,
        paidAt: new Date(),
      },
    });
    await transitionStatus(indentId, "PAYMENT_DONE", actorId, undefined, i.currentStatus as IndentStatus);
    const procs = await prisma.user.findMany({
      where: { role: "PROCUREMENT", isActive: true },
      select: { id: true },
    });
    await notifyUsers(
      procs.map((u) => u.id),
      {
        type: NotificationType.PAYMENT,
        title: "Finance completed accounts",
        body: `Payment completed for ${i.reference}. Upload the vendor's final invoice and send back to finance.`,
        indentId,
      }
    );
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: "FINANCE_ACCOUNTS_DONE",
      actorId,
      indentId,
      diff: {},
    });
  });
}

export async function financeComplete(
  indentId: string,
  actorId: string,
  role: Role,
  proofDocumentId: string
) {
  return withIndentTransaction(indentId, async () => {
    if (!canFinance(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({
      where: { id: indentId },
      include: { purchaseOrders: { take: 1 }, invoices: { take: 1 } },
    });
    if (i.currentStatus !== "PENDING_FINANCE") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    if (i.purchaseOrders.length === 0) {
      throw new DomainRuleError("A purchase order is required before payment");
    }
    const proforma = await prisma.invoice.findFirst({ where: { indentId, kind: "PROFORMA" } });
    if (!proforma) {
      throw new DomainRuleError("A proforma invoice is required before payment");
    }
    const existing = await prisma.payment.findFirst({
      where: { indentId, status: "COMPLETED" },
    });
    if (existing) throw new ConflictError("A completed payment already exists for this case.");
    await prisma.payment.create({
      data: {
        indentId,
        status: "COMPLETED",
        proofDocumentId,
        recordedById: actorId,
        paidAt: new Date(),
      },
    });
    await transitionStatus(indentId, "PAYMENT_DONE", actorId, undefined, i.currentStatus);
    const procs = await prisma.user.findMany({
      where: { role: "PROCUREMENT", isActive: true },
      select: { id: true },
    });
    await notifyUsers(
      procs.map((u) => u.id),
      {
        type: NotificationType.PAYMENT,
        title: "Payment completed",
        body: `Finance marked payment for ${i.reference}.`,
        indentId,
      }
    );
    await appendAudit({
      entityType: "Payment",
      entityId: indentId,
      action: "FINANCE_PAID",
      actorId,
      indentId,
      diff: { proofDocumentId },
    });
  });
}

export async function sendFinalInvoiceToFinance(indentId: string, actorId: string, role: Role) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId }, include: { item: true } });
    if (i.currentStatus !== "PAYMENT_DONE") throw new DomainRuleError("Save the final invoice first, then send to finance");
    const invRows = await prisma.invoice.findMany({
      where: { indentId, kind: "FINAL" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    const inv = invRows[0] as { documentId?: string | null } | undefined;
    if (!inv?.documentId) throw new DomainRuleError("The final invoice PDF must be recorded before sending to finance");

    await transitionStatus(indentId, "PENDING_FINANCE_FINAL", actorId, undefined, i.currentStatus as IndentStatus);
    const fins = await prisma.user.findMany({
      where: { role: "FINANCE", isActive: true },
      select: { id: true },
    });
    await notifyUsers(
      fins.map((u) => u.id),
      {
        type: NotificationType.APPROVAL_REQUIRED,
        title: "Finance — final invoice review",
        body: `Final vendor invoice for ${i.reference} is ready for review.`,
        indentId,
      }
    );
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: "FINAL_INVOICE_SENT_TO_FINANCE",
      actorId,
      indentId,
      diff: {},
    });
  });
}

export async function financeCompleteFinalReview(indentId: string, actorId: string, role: Role) {
  return withIndentTransaction(indentId, async () => {
    if (!canFinance(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId }, include: { item: true } });
    if (i.currentStatus !== "PENDING_FINANCE_FINAL") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    const invRows = await prisma.invoice.findMany({
      where: { indentId, kind: "FINAL" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    const inv = invRows[0] as { documentId?: string | null } | undefined;
    if (!inv?.documentId) throw new DomainRuleError("A final invoice is required");

    await transitionStatus(indentId, "CLOSED", actorId, undefined, i.currentStatus as IndentStatus);
    const procs = await prisma.user.findMany({
      where: { role: "PROCUREMENT", isActive: true },
      select: { id: true },
    });
    await notifyUsers(
      procs.map((u) => u.id),
      {
        type: NotificationType.PAYMENT,
        title: "Case closed",
        body: `Finance approved the final invoice for ${i.reference}. Workflow complete.`,
        indentId,
      }
    );
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: "FINANCE_FINAL_REVIEW_DONE",
      actorId,
      indentId,
      diff: {},
    });
  });
}

export async function procurementSendVendorProof(indentId: string, actorId: string, role: Role) {
  return withIndentTransaction(indentId, async () => {
    if (!canProcurement(role)) throw new AuthorizationError();
    const i = await prisma.indent.findUniqueOrThrow({ where: { id: indentId } });
    if (i.currentStatus !== "PAYMENT_DONE") throw new ConflictError("This action does not apply to the case's current state. Refresh and retry.");
    await prisma.payment.updateMany({
      where: { indentId },
      data: { vendorProofSentAt: new Date() },
    });
    await transitionStatus(indentId, "PAYMENT_PROOF_TO_VENDOR", actorId, undefined, i.currentStatus);
    await transitionStatus(indentId, "CLOSED", actorId, undefined, "PAYMENT_PROOF_TO_VENDOR");
    await appendAudit({
      entityType: "Indent",
      entityId: indentId,
      action: "VENDOR_PROOF_SENT",
      actorId,
      indentId,
      diff: {},
    });
  });
}
