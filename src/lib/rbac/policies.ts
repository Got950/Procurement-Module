import type { Role, IndentStatus } from "@/lib/domain-types";
import { DocumentType } from "@/lib/domain-types";

export type NavLink = { href: string; label: string; icon: string };

export const navForRole: Record<Role, NavLink[]> = {
  REQUESTER: [
    { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
    { href: "/indents", label: "Indents", icon: "FileText" },
    { href: "/copilot", label: "Copilot", icon: "MessageSquare" },
    { href: "/notifications", label: "Notifications", icon: "Bell" },
  ],
  TEAM_LEADER: [
    { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
    { href: "/approvals", label: "Team Lead queue", icon: "CheckCircle" },
    { href: "/indents", label: "All indents", icon: "FileText" },
    { href: "/copilot", label: "Copilot", icon: "MessageSquare" },
    { href: "/notifications", label: "Notifications", icon: "Bell" },
  ],
  PROCUREMENT: [
    { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
    { href: "/procurement/queue", label: "Queue", icon: "Inbox" },
    { href: "/indents", label: "Indents", icon: "FileText" },
    { href: "/vendors", label: "Vendors", icon: "Building2" },
    { href: "/items", label: "Items", icon: "Package" },
    { href: "/documents", label: "Documents", icon: "FolderOpen" },
    { href: "/copilot", label: "Copilot", icon: "MessageSquare" },
    { href: "/notifications", label: "Notifications", icon: "Bell" },
  ],
  DIRECTOR: [
    { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
    { href: "/approvals?stage=director", label: "Director approvals", icon: "Shield" },
    { href: "/indents", label: "Indents", icon: "FileText" },
    { href: "/copilot", label: "Copilot", icon: "MessageSquare" },
    { href: "/notifications", label: "Notifications", icon: "Bell" },
  ],
  MD: [
    { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
    { href: "/approvals?stage=md", label: "MD approvals", icon: "Shield" },
    { href: "/indents", label: "Indents", icon: "FileText" },
    { href: "/copilot", label: "Copilot", icon: "MessageSquare" },
    { href: "/notifications", label: "Notifications", icon: "Bell" },
  ],
  FINANCE: [
    { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
    { href: "/finance/payments", label: "Payments", icon: "Banknote" },
    { href: "/documents", label: "Documents", icon: "FolderOpen" },
    { href: "/copilot", label: "Copilot", icon: "MessageSquare" },
    { href: "/notifications", label: "Notifications", icon: "Bell" },
  ],
  ADMIN: [
    { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
    { href: "/admin/users", label: "User management", icon: "Shield" },
    { href: "/approvals", label: "Approvals", icon: "CheckCircle" },
    { href: "/procurement/queue", label: "Queue", icon: "Inbox" },
    { href: "/indents", label: "Indents", icon: "FileText" },
    { href: "/vendors", label: "Vendors", icon: "Building2" },
    { href: "/items", label: "Items", icon: "Package" },
    { href: "/documents", label: "Documents", icon: "FolderOpen" },
    { href: "/finance/payments", label: "Payments", icon: "Banknote" },
    { href: "/copilot", label: "Copilot", icon: "MessageSquare" },
    { href: "/notifications", label: "Notifications", icon: "Bell" },
  ],
};

export function getNavForRole(role: string): NavLink[] {
  if (role in navForRole) return navForRole[role as Role];
  return [{ href: "/dashboard", label: "Overview", icon: "LayoutDashboard" }];
}

export function canManageUsers(role: string) {
  return role === "ADMIN";
}

export function canCreateIndent(role: Role) {
  return role === "REQUESTER" || role === "ADMIN";
}

export function canApproveIndent(role: Role, status: IndentStatus) {
  return role === "TEAM_LEADER" && status === "PENDING_TL_INDENT";
}

export function canApproveVendorChoice(role: Role, status: IndentStatus) {
  return role === "TEAM_LEADER" && status === "PENDING_TL_VENDOR";
}

export function canDirectorApprove(role: Role, status: IndentStatus) {
  return role === "DIRECTOR" && status === "PENDING_DIRECTOR";
}

export function canMdApprove(role: Role, status: IndentStatus) {
  return role === "MD" && status === "PENDING_MD";
}

export function canProcurement(role: Role) {
  return role === "PROCUREMENT" || role === "ADMIN";
}

export function canFinance(role: Role) {
  return role === "FINANCE" || role === "ADMIN";
}

export function canManageMasters(role: Role) {
  return role === "PROCUREMENT" || role === "ADMIN";
}

/**
 * Item catalog access for indent creation (REQUESTER/ADMIN) and masters
 * (PROCUREMENT/ADMIN). Other roles do not need the catalog via API/Copilot.
 */
export function canAccessItemCatalog(role: Role) {
  return role === "REQUESTER" || role === "PROCUREMENT" || role === "ADMIN";
}

const FINANCE_UPLOAD_STATUSES = new Set<string>([
  "PENDING_FINANCE",
  "PAYMENT_DONE",
  "PENDING_FINANCE_FINAL",
]);

const REQUESTER_UPLOAD_TYPES = new Set<string>([
  DocumentType.INDENT_ATTACHMENT,
  DocumentType.OTHER,
]);

const PROCUREMENT_UPLOAD_TYPES = new Set<string>([
  DocumentType.QUOTATION,
  DocumentType.PURCHASE_ORDER,
  DocumentType.INDENT_ATTACHMENT,
  DocumentType.OTHER,
  DocumentType.INVOICE,
]);

const FINANCE_UPLOAD_TYPES = new Set<string>([
  DocumentType.INVOICE,
  DocumentType.PAYMENT_PROOF,
]);

/**
 * Write authorization for generic document upload. View privilege alone is never enough.
 * Specialized routes (quotations/PO) still enforce their own role checks.
 */
export function canUploadDocument(
  role: string,
  indent: { requesterId: string; currentStatus: string },
  type: string,
  userId: string
): boolean {
  if (role === "ADMIN") return true;
  if (role === "REQUESTER") {
    return (
      indent.requesterId === userId &&
      REQUESTER_UPLOAD_TYPES.has(type) &&
      (indent.currentStatus === "DRAFT" ||
        indent.currentStatus === "REJECTED_TL_INDENT" ||
        indent.currentStatus === "REJECTED_TL_VENDOR" ||
        indent.currentStatus === "REJECTED_DIRECTOR" ||
        indent.currentStatus === "REJECTED_MD")
    );
  }
  if (role === "PROCUREMENT") {
    return PROCUREMENT_UPLOAD_TYPES.has(type);
  }
  if (role === "FINANCE") {
    return FINANCE_UPLOAD_TYPES.has(type) && FINANCE_UPLOAD_STATUSES.has(indent.currentStatus);
  }
  // Approvers (TL / DIRECTOR / MD) may view but not attach documents.
  return false;
}
