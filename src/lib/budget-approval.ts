import type { IndentStatus } from "@/lib/domain-types";

/** Team Leader vendor approval is sufficient; Director is view-only. */
export const BUDGET_TL_ONLY_MAX = 50_000;

/** Director approval required; MD not required. */
export const BUDGET_DIRECTOR_MAX = 500_000;

export type BudgetTrack = "TL_ONLY" | "DIRECTOR" | "MD";

export function parseBudgetAmount(amount: string | number | null | undefined): number | null {
  if (amount == null || amount === "") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Routing from procurement approval value (INR). Missing value uses Director path. */
export function getBudgetTrack(amount: string | number | null | undefined): BudgetTrack {
  const n = parseBudgetAmount(amount);
  if (n == null) return "DIRECTOR";
  if (n <= BUDGET_TL_ONLY_MAX) return "TL_ONLY";
  if (n <= BUDGET_DIRECTOR_MAX) return "DIRECTOR";
  return "MD";
}

/**
 * Parse total/max INR from procurement cost / commercial text (e.g. 50000, 5 lakh, 50k).
 *
 * **UI helper only — never an input to approval routing.** It keeps the largest
 * number it finds, including any bare four-digit token, so a quantity, a year or
 * a GST fragment can read as the amount. Use it to pre-fill a field the user
 * confirms; `approvalBudgetAmount` is the authoritative value.
 */
export function parseBudgetFromCostText(text: string | null | undefined): number | null {
  if (!text?.trim()) return null;
  const normalized = text.toLowerCase().replace(/,/g, " ");
  let best: number | null = null;

  function consider(n: number) {
    if (!Number.isFinite(n) || n <= 0) return;
    if (best == null || n > best) best = n;
  }

  for (const m of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs)\b/gi)) {
    consider(Number(m[1]) * 100_000);
  }
  for (const m of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/gi)) {
    consider(Number(m[1]) * 10_000_000);
  }
  for (const m of normalized.matchAll(/(\d+(?:\.\d+)?)\s*k\b/gi)) {
    consider(Number(m[1]) * 1_000);
  }
  for (const m of normalized.matchAll(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/gi)) {
    consider(Number(m[1]));
  }
  for (const m of normalized.matchAll(/\b(\d{4,}(?:\.\d+)?)\b/g)) {
    consider(Number(m[1]));
  }

  return best;
}

export type IndentBudgetSource = {
  approvalBudgetAmount?: string | number | null;
};

/**
 * Approval routing amount from procurement (not the requester estimate).
 * The structured column is the sole input: routing used to fall back to parsing
 * the free-text cost field, which let the tier be chosen by phrasing.
 */
export function resolveIndentBudgetAmount(indent: IndentBudgetSource): number | null {
  return parseBudgetAmount(indent.approvalBudgetAmount);
}

export function getIndentBudgetTrack(indent: IndentBudgetSource): BudgetTrack {
  return getBudgetTrack(resolveIndentBudgetAmount(indent));
}

export function requiresDirectorApproval(track: BudgetTrack): boolean {
  return track === "DIRECTOR" || track === "MD";
}

export function requiresMdApproval(track: BudgetTrack): boolean {
  return track === "MD";
}

/** Statuses where Director may observe TL-only cases (no approval). */
export const DIRECTOR_OBSERVE_STATUSES: IndentStatus[] = [
  "PROCUREMENT_ACTIVE",
  "RFQ_SENT",
  "AWAITING_QUOTES",
  "QUOTES_READY",
  "PENDING_TL_VENDOR",
  "REJECTED_TL_VENDOR",
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

export function isDirectorObserveStatus(status: string): boolean {
  return DIRECTOR_OBSERVE_STATUSES.includes(status as IndentStatus);
}

export function isDirectorViewOnlyIndent(
  indent: IndentBudgetSource,
  status: string
): boolean {
  return getIndentBudgetTrack(indent) === "TL_ONLY" && isDirectorObserveStatus(status);
}

export function budgetTrackLabel(track: BudgetTrack): string {
  switch (track) {
    case "TL_ONLY":
      return "Up to ₹50,000 — Team Leader sign-off (Director view only)";
    case "DIRECTOR":
      return "₹50,001–₹5,00,000 — Director approval (from procurement cost)";
    case "MD":
      return "Above ₹5,00,000 — Director + MD approval (from procurement cost)";
  }
}
