import type { IndentStatus, Role } from "@/lib/domain-types";
import { ALLOWED_TRANSITIONS } from "@/server/domain/state-machine";
import {
  getIndentBudgetTrack,
  requiresDirectorApproval,
  requiresMdApproval,
  resolveIndentBudgetAmount,
  type IndentBudgetSource,
} from "@/lib/budget-approval";

/**
 * A read-only description of the existing state machine for the Copilot to
 * explain. It adds no transitions and grants no permissions: `ownerRole` mirrors
 * the role each workflow function already requires, and the reachable states
 * come from `ALLOWED_TRANSITIONS`.
 */
const STAGE: Record<IndentStatus, { ownerRole: Role | null; nextAction: string }> = {
  DRAFT: { ownerRole: "REQUESTER", nextAction: "Requester submits the indent for Team Leader review." },
  PENDING_TL_INDENT: { ownerRole: "TEAM_LEADER", nextAction: "Team Leader approves or rejects the indent." },
  REJECTED_TL_INDENT: { ownerRole: null, nextAction: "Closed: the Team Leader rejected the indent." },
  PROCUREMENT_ACTIVE: { ownerRole: "PROCUREMENT", nextAction: "Procurement sends an RFQ to vendors." },
  RFQ_SENT: { ownerRole: "PROCUREMENT", nextAction: "Procurement collects vendor quotations." },
  AWAITING_QUOTES: { ownerRole: "PROCUREMENT", nextAction: "Procurement collects vendor quotations." },
  QUOTES_READY: { ownerRole: "PROCUREMENT", nextAction: "Procurement compares quotations and sends a vendor choice to the Team Leader." },
  PENDING_TL_VENDOR: { ownerRole: "TEAM_LEADER", nextAction: "Team Leader approves or rejects the vendor selection." },
  REJECTED_TL_VENDOR: { ownerRole: null, nextAction: "Closed: the Team Leader rejected the vendor selection." },
  PENDING_DIRECTOR: { ownerRole: "DIRECTOR", nextAction: "Director approves or rejects the vendor selection." },
  REJECTED_DIRECTOR: { ownerRole: null, nextAction: "Closed: the Director rejected the vendor selection." },
  PENDING_MD: { ownerRole: "MD", nextAction: "MD approves or rejects the vendor selection." },
  REJECTED_MD: { ownerRole: null, nextAction: "Closed: the MD rejected the vendor selection." },
  PROCUREMENT_PO: { ownerRole: "PROCUREMENT", nextAction: "Procurement drafts and sends the purchase order." },
  PO_DRAFT: { ownerRole: "PROCUREMENT", nextAction: "Procurement sends the drafted purchase order to the vendor." },
  PO_SENT: { ownerRole: "PROCUREMENT", nextAction: "Procurement records the vendor's proforma invoice." },
  AWAITING_INVOICE: { ownerRole: "PROCUREMENT", nextAction: "Procurement sends the case to finance with PO and proforma invoice." },
  PENDING_FINANCE: { ownerRole: "FINANCE", nextAction: "Finance completes the accounts section and records payment." },
  PAYMENT_DONE: { ownerRole: "PROCUREMENT", nextAction: "Procurement records the final invoice and sends it to finance, or sends payment proof to the vendor." },
  PENDING_FINANCE_FINAL: { ownerRole: "FINANCE", nextAction: "Finance reviews the final invoice and closes the case." },
  PAYMENT_PROOF_TO_VENDOR: { ownerRole: "PROCUREMENT", nextAction: "Case closes once payment proof has gone to the vendor." },
  CLOSED: { ownerRole: null, nextAction: "Closed: no further action." },
};

export function describeWorkflow(indent: IndentBudgetSource & { currentStatus: string }) {
  const status = indent.currentStatus as IndentStatus;
  const stage = STAGE[status] ?? { ownerRole: null, nextAction: "Unknown state." };
  const track = getIndentBudgetTrack(indent);
  return {
    currentStatus: status,
    responsibleRole: stage.ownerRole,
    nextAction: stage.nextAction,
    reachableStatuses: ALLOWED_TRANSITIONS[status] ?? [],
    terminal: (ALLOWED_TRANSITIONS[status] ?? []).length === 0,
    approvalBudgetAmount: resolveIndentBudgetAmount(indent),
    budgetTrack: track,
    directorApprovalRequired: requiresDirectorApproval(track),
    mdApprovalRequired: requiresMdApproval(track),
  };
}
