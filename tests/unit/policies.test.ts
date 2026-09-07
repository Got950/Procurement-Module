import { describe, expect, it } from "vitest";
import {
  canApproveIndent,
  canApproveVendorChoice,
  canDirectorApprove,
  canFinance,
  canMdApprove,
  canProcurement,
  canUploadDocument,
} from "@/lib/rbac/policies";
import { DocumentType } from "@/lib/domain-types";

describe("stage ownership", () => {
  it("binds each approval stage to its role and status", () => {
    expect(canApproveIndent("TEAM_LEADER", "PENDING_TL_INDENT")).toBe(true);
    expect(canApproveIndent("TEAM_LEADER", "PENDING_TL_VENDOR")).toBe(false);
    expect(canApproveVendorChoice("TEAM_LEADER", "PENDING_TL_VENDOR")).toBe(true);
    expect(canDirectorApprove("DIRECTOR", "PENDING_DIRECTOR")).toBe(true);
    expect(canDirectorApprove("DIRECTOR", "PENDING_MD")).toBe(false);
    expect(canMdApprove("MD", "PENDING_MD")).toBe(true);
    expect(canProcurement("PROCUREMENT")).toBe(true);
    expect(canProcurement("FINANCE")).toBe(false);
    expect(canFinance("FINANCE")).toBe(true);
    expect(canFinance("REQUESTER")).toBe(false);
  });

  it("does not let ADMIN satisfy an approval stage (B-16)", () => {
    expect(canApproveIndent("ADMIN", "PENDING_TL_INDENT")).toBe(false);
    expect(canApproveVendorChoice("ADMIN", "PENDING_TL_VENDOR")).toBe(false);
    expect(canDirectorApprove("ADMIN", "PENDING_DIRECTOR")).toBe(false);
    expect(canMdApprove("ADMIN", "PENDING_MD")).toBe(false);
    expect(canMdApprove("ADMIN", "DRAFT")).toBe(false);
  });
});

describe("document upload authorization (SEC-002)", () => {
  const draft = { requesterId: "req-1", currentStatus: "DRAFT" };
  const financeCase = { requesterId: "req-1", currentStatus: "PENDING_FINANCE" };

  it("blocks FINANCE from uploading to a requester draft", () => {
    expect(canUploadDocument("FINANCE", draft, DocumentType.OTHER, "fin-1")).toBe(false);
    expect(canUploadDocument("FINANCE", draft, DocumentType.INVOICE, "fin-1")).toBe(false);
  });

  it("allows FINANCE invoice upload only in finance statuses", () => {
    expect(
      canUploadDocument("FINANCE", financeCase, DocumentType.INVOICE, "fin-1")
    ).toBe(true);
    expect(
      canUploadDocument("FINANCE", financeCase, DocumentType.OTHER, "fin-1")
    ).toBe(false);
  });

  it("allows REQUESTER attachments only on own editable indents", () => {
    expect(
      canUploadDocument("REQUESTER", draft, DocumentType.INDENT_ATTACHMENT, "req-1")
    ).toBe(true);
    expect(
      canUploadDocument("REQUESTER", draft, DocumentType.INDENT_ATTACHMENT, "other")
    ).toBe(false);
    expect(
      canUploadDocument("REQUESTER", financeCase, DocumentType.INDENT_ATTACHMENT, "req-1")
    ).toBe(false);
  });

  it("denies approver roles from uploading", () => {
    expect(canUploadDocument("TEAM_LEADER", draft, DocumentType.OTHER, "tl-1")).toBe(false);
    expect(canUploadDocument("DIRECTOR", financeCase, DocumentType.INVOICE, "d-1")).toBe(false);
    expect(canUploadDocument("MD", financeCase, DocumentType.INVOICE, "m-1")).toBe(false);
  });
});
