import type { IndentStatus } from "@/lib/domain-types";
import { ConflictError } from "@/lib/errors";

/**
 * The declarative transition table. Previously the reachable states were
 * implicit in fifteen scattered `if (i.currentStatus !== ...)` checks and
 * `transitionStatus` accepted any target, so a new call site could put a case
 * into a status no handler expects.
 *
 * Both closure paths are listed deliberately: finance closing after the final
 * invoice review, and procurement closing after sending payment proof to the
 * vendor. Both are reachable in the current UI (PLAN OQ-3 is open; neither is
 * removed here because that would change user-facing behaviour).
 */
export const ALLOWED_TRANSITIONS: Record<IndentStatus, readonly IndentStatus[]> = {
  DRAFT: ["PENDING_TL_INDENT"],
  PENDING_TL_INDENT: ["PROCUREMENT_ACTIVE", "REJECTED_TL_INDENT"],
  REJECTED_TL_INDENT: [],
  PROCUREMENT_ACTIVE: ["RFQ_SENT", "QUOTES_READY"],
  RFQ_SENT: ["AWAITING_QUOTES", "QUOTES_READY"],
  AWAITING_QUOTES: ["RFQ_SENT", "QUOTES_READY"],
  QUOTES_READY: ["RFQ_SENT", "PENDING_TL_VENDOR"],
  PENDING_TL_VENDOR: ["PROCUREMENT_PO", "PENDING_DIRECTOR", "REJECTED_TL_VENDOR"],
  REJECTED_TL_VENDOR: [],
  PENDING_DIRECTOR: ["PROCUREMENT_PO", "PENDING_MD", "REJECTED_DIRECTOR"],
  REJECTED_DIRECTOR: [],
  PENDING_MD: ["PROCUREMENT_PO", "REJECTED_MD"],
  REJECTED_MD: [],
  PROCUREMENT_PO: ["PO_DRAFT", "PO_SENT", "AWAITING_INVOICE"],
  PO_DRAFT: ["PO_SENT", "AWAITING_INVOICE"],
  PO_SENT: ["AWAITING_INVOICE"],
  AWAITING_INVOICE: ["PENDING_FINANCE"],
  PENDING_FINANCE: ["PAYMENT_DONE"],
  PAYMENT_DONE: ["PENDING_FINANCE_FINAL", "PAYMENT_PROOF_TO_VENDOR"],
  PENDING_FINANCE_FINAL: ["CLOSED"],
  PAYMENT_PROOF_TO_VENDOR: ["CLOSED"],
  CLOSED: [],
};

export function isTransitionAllowed(from: IndentStatus, to: IndentStatus) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Throws a 409 rather than a 400: the case is in a state this action does not
 *  apply to, which the client resolves by refreshing. */
export function assertTransition(from: IndentStatus, to: IndentStatus) {
  if (!isTransitionAllowed(from, to)) {
    throw new ConflictError(
      `Cannot move this case from ${from} to ${to}. Refresh to see its current state.`
    );
  }
}
