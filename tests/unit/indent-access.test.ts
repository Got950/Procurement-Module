import { describe, expect, it } from "vitest";
import { IndentStatus, Role } from "@/lib/domain-types";
import {
  canViewIndent,
  indentListWhere,
  indentListWhereForRole,
} from "@/lib/indent-access";
import { BUDGET_TL_ONLY_MAX } from "@/lib/budget-approval";

describe("indentListWhere / canViewIndent authorization boundary", () => {
  const owner = "requester-a";
  const other = "requester-b";

  it("alias indentListWhereForRole matches indentListWhere", () => {
    for (const role of Object.values(Role)) {
      expect(indentListWhereForRole(role, owner)).toEqual(indentListWhere(role, owner));
    }
  });

  it("unknown roles fail closed on list and detail", () => {
    expect(indentListWhere("SUPERUSER", owner)).toEqual({ id: "__none__" });
    expect(
      canViewIndent(
        { sub: other, role: "SUPERUSER" },
        { requesterId: owner, currentStatus: IndentStatus.DRAFT }
      )
    ).toBe(false);
  });

  it("DIRECTOR may view PENDING_DIRECTOR and ≤50k observe cases only", () => {
    expect(
      canViewIndent(
        { sub: other, role: Role.DIRECTOR },
        { requesterId: owner, currentStatus: IndentStatus.PENDING_DIRECTOR }
      )
    ).toBe(true);
    expect(
      canViewIndent(
        { sub: other, role: Role.DIRECTOR },
        {
          requesterId: owner,
          currentStatus: IndentStatus.PROCUREMENT_ACTIVE,
          approvalBudgetAmount: BUDGET_TL_ONLY_MAX,
        }
      )
    ).toBe(true);
    expect(
      canViewIndent(
        { sub: other, role: Role.DIRECTOR },
        {
          requesterId: owner,
          currentStatus: IndentStatus.DRAFT,
          approvalBudgetAmount: BUDGET_TL_ONLY_MAX,
        }
      )
    ).toBe(false);
    expect(
      canViewIndent(
        { sub: other, role: Role.DIRECTOR },
        {
          requesterId: owner,
          currentStatus: IndentStatus.PROCUREMENT_ACTIVE,
          approvalBudgetAmount: BUDGET_TL_ONLY_MAX + 1,
        }
      )
    ).toBe(false);
  });

  it("MD may view PENDING_MD and ≤50k observe cases only", () => {
    expect(
      canViewIndent(
        { sub: other, role: Role.MD },
        { requesterId: owner, currentStatus: IndentStatus.PENDING_MD }
      )
    ).toBe(true);
    expect(
      canViewIndent(
        { sub: other, role: Role.MD },
        { requesterId: owner, currentStatus: IndentStatus.PENDING_DIRECTOR }
      )
    ).toBe(false);
  });

  it("does not leak via missing status on scoped roles", () => {
    expect(
      canViewIndent({ sub: other, role: Role.TEAM_LEADER }, { requesterId: owner })
    ).toBe(false);
    expect(
      canViewIndent({ sub: other, role: Role.FINANCE }, { requesterId: owner })
    ).toBe(false);
  });
});
