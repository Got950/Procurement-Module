import { IndentStatus, Role } from "@/lib/domain-types";
import {
  directorIndentListWhere,
  mdIndentListWhere,
} from "@/lib/director-indent-filters";
import {
  isDirectorViewOnlyIndent,
  type IndentBudgetSource,
} from "@/lib/budget-approval";

export type SessionLike = { sub: string; role: string };

const TL_LIST_STATUSES: IndentStatus[] = [
  IndentStatus.PENDING_TL_INDENT,
  IndentStatus.PENDING_TL_VENDOR,
];

const FINANCE_LIST_STATUSES: IndentStatus[] = [
  IndentStatus.PENDING_FINANCE,
  IndentStatus.PAYMENT_DONE,
  IndentStatus.PENDING_FINANCE_FINAL,
];

/**
 * Canonical Prisma `where` for indent lists / recent / aggregates.
 * Mirrors GET /api/indents — role queue scope, not org-wide dumps.
 *
 * - REQUESTER: own indents only
 * - TEAM_LEADER: pending TL indent/vendor decisions
 * - DIRECTOR / MD: pending sign-off or ≤50k observe pipeline
 * - FINANCE: finance-stage statuses
 * - PROCUREMENT / ADMIN: organization-wide (workflow roles)
 * - unknown roles: empty result set
 */
export function indentListWhere(
  role: string,
  userId: string
): Record<string, unknown> {
  if (role === Role.ADMIN || role === Role.PROCUREMENT) return {};
  if (role === Role.REQUESTER) return { requesterId: userId };
  if (role === Role.TEAM_LEADER) {
    return { currentStatus: { in: TL_LIST_STATUSES } };
  }
  if (role === Role.DIRECTOR) return directorIndentListWhere();
  if (role === Role.MD) return mdIndentListWhere();
  if (role === Role.FINANCE) {
    return { currentStatus: { in: FINANCE_LIST_STATUSES } };
  }
  // Fail closed for unknown roles.
  return { id: "__none__" };
}

/** @deprecated Prefer {@link indentListWhere}; kept as alias for call sites. */
export function indentListWhereForRole(
  role: string,
  userId: string
): Record<string, unknown> {
  return indentListWhere(role, userId);
}

export type IndentAccessFields = IndentBudgetSource & {
  requesterId: string;
  currentStatus: string;
};

/**
 * Whether this user may open/view an indent (detail, PDF, documents, Copilot).
 * Same boundary as list scope so IDOR cannot widen access beyond the queue.
 */
export function canViewIndent(
  session: SessionLike,
  indent: IndentAccessFields | { requesterId: string; currentStatus?: string }
): boolean {
  const role = session.role;
  if (role === Role.ADMIN || role === Role.PROCUREMENT) return true;
  if (role === Role.REQUESTER) return indent.requesterId === session.sub;

  const status = indent.currentStatus;
  if (status == null) return false;

  if (role === Role.TEAM_LEADER) {
    return TL_LIST_STATUSES.includes(status as IndentStatus);
  }
  if (role === Role.FINANCE) {
    return FINANCE_LIST_STATUSES.includes(status as IndentStatus);
  }
  if (role === Role.DIRECTOR) {
    if (status === IndentStatus.PENDING_DIRECTOR) return true;
    return isDirectorViewOnlyIndent(indent as IndentBudgetSource, status);
  }
  if (role === Role.MD) {
    if (status === IndentStatus.PENDING_MD) return true;
    return isDirectorViewOnlyIndent(indent as IndentBudgetSource, status);
  }
  return false;
}
