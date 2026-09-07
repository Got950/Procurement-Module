import { Role } from "@/lib/domain-types";
import { canFinance, canProcurement } from "@/lib/rbac/policies";

/** Bank account fields — only finance/admin/procurement need them in API payloads. */
const BANK_FIELDS = [
  "financeAccountNo",
  "financeIfscCode",
  "financeBranchName",
  "financeAccountHolderName",
] as const;

export function canViewBankFields(role: Role | string): boolean {
  if (!Object.values(Role).includes(role as Role)) return false;
  return canFinance(role as Role) || canProcurement(role as Role);
}

/** Strip sensitive bank details from an indent payload for unauthorized roles. */
export function redactIndentBankFields<T extends Record<string, unknown>>(
  indent: T,
  role: Role | string
): T {
  if (canViewBankFields(role)) return indent;
  const out = { ...indent };
  for (const key of BANK_FIELDS) {
    if (key in out) (out as Record<string, unknown>)[key] = null;
  }
  return out;
}

/** Public document DTO — never expose filesystem/S3 layout to clients. */
export function publicDocument<T extends Record<string, unknown>>(
  doc: T
): Omit<T, "storagePath" | "s3Key"> {
  const rest = { ...doc } as Record<string, unknown>;
  delete rest.storagePath;
  delete rest.s3Key;
  return rest as Omit<T, "storagePath" | "s3Key">;
}

export function publicDocuments<T extends Record<string, unknown>>(
  docs: T[] | null | undefined
): Omit<T, "storagePath" | "s3Key">[] {
  return (docs ?? []).map((d) => publicDocument(d));
}
