import type { IndentStatus } from "@/lib/domain-types";
import { getBudgetTrack, resolveIndentBudgetAmount, type BudgetTrack, type IndentBudgetSource } from "@/lib/budget-approval";

/** Sticky tracker labels (UI only; order matches enterprise flow). */
export const WORKFLOW_TRACKER_STEPS = [
  "Requester",
  "Team Lead 1",
  "Procurement",
  "AI Match",
  "Team Lead 2",
  "Director",
  "MD",
  "Procurement Final",
] as const;

export type WorkflowTrackerIndex = number;

/** Steps shown on the tracker bar for a given budget track. */
export function getWorkflowTrackerSteps(track: BudgetTrack): string[] {
  const all = [...WORKFLOW_TRACKER_STEPS];
  if (track === "TL_ONLY") return all.filter((s) => s !== "Director" && s !== "MD");
  if (track === "DIRECTOR") return all.filter((s) => s !== "MD");
  return all;
}

const STATUS_ORDER: IndentStatus[] = [
  "DRAFT",
  "PENDING_TL_INDENT",
  "REJECTED_TL_INDENT",
  "PROCUREMENT_ACTIVE",
  "RFQ_SENT",
  "AWAITING_QUOTES",
  "QUOTES_READY",
  "PENDING_TL_VENDOR",
  "REJECTED_TL_VENDOR",
  "PENDING_DIRECTOR",
  "REJECTED_DIRECTOR",
  "PENDING_MD",
  "REJECTED_MD",
  "PROCUREMENT_PO",
  "PO_DRAFT",
  "PO_SENT",
  "AWAITING_INVOICE",
  "PENDING_FINANCE",
  "PAYMENT_DONE",
  "PENDING_FINANCE_FINAL",
  "PAYMENT_PROOF_TO_VENDOR",
  "CLOSED",
];

function statusToTrackerStep(status: IndentStatus, track: BudgetTrack): string {
  switch (status) {
    case "DRAFT":
      return "Requester";
    case "PENDING_TL_INDENT":
    case "REJECTED_TL_INDENT":
      return "Team Lead 1";
    case "PROCUREMENT_ACTIVE":
    case "RFQ_SENT":
    case "AWAITING_QUOTES":
      return "Procurement";
    case "QUOTES_READY":
      return "AI Match";
    case "PENDING_TL_VENDOR":
    case "REJECTED_TL_VENDOR":
      return "Team Lead 2";
    case "PENDING_DIRECTOR":
    case "REJECTED_DIRECTOR":
      return track === "TL_ONLY" ? "Procurement Final" : "Director";
    case "PENDING_MD":
    case "REJECTED_MD":
      return "MD";
    default:
      return "Procurement Final";
  }
}

/** Highlighted step index for the tracker bar (depends on procurement budget track). */
export function getWorkflowTrackerIndex(
  status: string,
  budgetSource?: IndentBudgetSource | null
): WorkflowTrackerIndex {
  const track = budgetSource ? getBudgetTrack(resolveIndentBudgetAmount(budgetSource)) : "DIRECTOR";
  const steps = getWorkflowTrackerSteps(track);
  const stepName = statusToTrackerStep(status as IndentStatus, track);
  const idx = steps.indexOf(stepName);
  return idx >= 0 ? idx : steps.length - 1;
}

export function hasPassedProcurementStart(status: string): boolean {
  const i = STATUS_ORDER.indexOf(status as IndentStatus);
  const j = STATUS_ORDER.indexOf("PROCUREMENT_ACTIVE");
  return i >= j && i >= 0;
}

export function showEarlyExitRejectedIndent(status: string): boolean {
  return status === "REJECTED_TL_INDENT";
}
