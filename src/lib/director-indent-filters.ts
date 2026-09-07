import { BUDGET_TL_ONLY_MAX, DIRECTOR_OBSERVE_STATUSES } from "@/lib/budget-approval";
import { IndentStatus } from "@/lib/domain-types";

/** ≤50k cases executives can monitor (view only, no approval). */
export function executiveObserveWhere() {
  return {
    approvalBudgetAmount: { lte: BUDGET_TL_ONLY_MAX },
    currentStatus: { in: DIRECTOR_OBSERVE_STATUSES },
  };
}

/** Director: pending sign-off or observe-only ≤50k pipeline. */
export function directorIndentListWhere() {
  return {
    OR: [{ currentStatus: IndentStatus.PENDING_DIRECTOR }, executiveObserveWhere()],
  };
}

/** MD: pending sign-off (>5L) or observe-only ≤50k pipeline. */
export function mdIndentListWhere() {
  return {
    OR: [{ currentStatus: IndentStatus.PENDING_MD }, executiveObserveWhere()],
  };
}
