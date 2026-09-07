import { describe, expect, it } from "vitest";
import {
  canViewBankFields,
  publicDocument,
  redactIndentBankFields,
} from "@/lib/api-sanitize";
import { Role } from "@/lib/domain-types";

describe("api-sanitize bank field redaction", () => {
  const sample = {
    id: "1",
    financeAccountNo: "123456",
    financeIfscCode: "ABCD0123456",
    financeBranchName: "Main",
    financeAccountHolderName: "Acme",
    financeRemarks: "ok",
  };

  it("allows finance, admin, procurement", () => {
    expect(canViewBankFields(Role.FINANCE)).toBe(true);
    expect(canViewBankFields(Role.ADMIN)).toBe(true);
    expect(canViewBankFields(Role.PROCUREMENT)).toBe(true);
  });

  it("denies requester and approvers", () => {
    expect(canViewBankFields(Role.REQUESTER)).toBe(false);
    expect(canViewBankFields(Role.TEAM_LEADER)).toBe(false);
    expect(canViewBankFields(Role.DIRECTOR)).toBe(false);
    expect(canViewBankFields(Role.MD)).toBe(false);
  });

  it("redacts bank fields for requester", () => {
    const out = redactIndentBankFields(sample, Role.REQUESTER);
    expect(out.financeAccountNo).toBeNull();
    expect(out.financeIfscCode).toBeNull();
    expect(out.financeBranchName).toBeNull();
    expect(out.financeAccountHolderName).toBeNull();
    expect(out.financeRemarks).toBe("ok");
  });

  it("preserves bank fields for finance", () => {
    const out = redactIndentBankFields(sample, Role.FINANCE);
    expect(out.financeAccountNo).toBe("123456");
  });
});

describe("api-sanitize publicDocument", () => {
  it("strips storagePath and s3Key", () => {
    const out = publicDocument({
      id: "d1",
      filename: "a.pdf",
      storagePath: "data/uploads/x/a.pdf",
      s3Key: "uploads/x/a.pdf",
    });
    expect(out).toEqual({ id: "d1", filename: "a.pdf" });
    expect("storagePath" in out).toBe(false);
    expect("s3Key" in out).toBe(false);
  });
});
